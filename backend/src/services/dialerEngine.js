const { query, queryOne } = require('../db/connection');
const { getAMI } = require('./amiClient');

let engineRunning        = false;
let ioInstance           = null;
let socketServiceInstance = null;

const pendingLeads  = new Set(); // lead ids currently being processed
const leadChannels  = new Map(); // callId -> real lead channel (so hangup actually kicks the lead from the room)
const ABANDON_MS    = 7000;      // hold an answered lead this long for a free agent before abandoning
const SIMULATION    = process.env.SIMULATION_MODE === 'true';
const SIM_ANSWER_RATE = 0.65;   // 65% of calls "answer" in simulation

function getLeadChannel(callId) { return leadChannels.get(Number(callId)); }
function clearLeadChannel(callId) { leadChannels.delete(Number(callId)); }

// ── Time-window check ────────────────────────────────────────────────────────
// Evaluate the campaign's calling hours in the campaign's OWN timezone, not the
// server clock — otherwise a campaign runs shifted by the server's UTC offset
// (e.g. a Europe/London campaign on a UTC server starts an hour late in summer).
function isWithinTimeWindow(campaign) {
  try {
    const tz = campaign.timezone || 'UTC';
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    let hh = 0, mm = 0;
    for (const p of parts) {
      if (p.type === 'hour')   hh = parseInt(p.value, 10) % 24;
      if (p.type === 'minute') mm = parseInt(p.value, 10);
    }
    const [sh, sm] = (campaign.start_time || '00:00').split(':').map(Number);
    const [eh, em] = (campaign.end_time   || '23:59').split(':').map(Number);
    const cur = hh * 60 + mm;
    return cur >= sh * 60 + sm && cur <= eh * 60 + em;
  } catch (_) { return true; }
}

// ── Get next lead from hopper, fall back to direct query ──────────────────────
async function getNextLead(campaignId, maxAttempts, accountId) {
  const hop = await queryOne(
    `SELECT h.id as hopper_id, l.*
     FROM hopper h JOIN leads l ON l.id = h.lead_id
     WHERE h.campaign_id = ? AND h.status = 'ready' AND l.assigned_agent IS NULL
     ORDER BY h.priority DESC, h.added_at ASC LIMIT 1`,
    [campaignId]
  );
  if (hop) {
    await query("UPDATE hopper SET status = 'dialing' WHERE id = ?", [hop.hopper_id]);
    return hop;
  }
  return queryOne(
    `SELECT * FROM leads
     WHERE campaign_id = ? AND status IN ('new','called') AND assigned_agent IS NULL
       AND phone NOT IN (SELECT phone FROM dnc_list WHERE account_id = ?)
       AND (callback_at IS NULL OR callback_at <= NOW())
       AND attempts < ?
     ORDER BY status ASC, attempts ASC, created_at ASC LIMIT 1`,
    [campaignId, accountId, maxAttempts]
  );
}

// ── Call agent first to confirm audio (plays "you are the only person") ───────
async function callAgentReady(agent, ami) {
  if (!ami || !ami.isReady()) return;
  try {
    await ami.action({
      Action:   'Originate',
      Channel:  `PJSIP/${agent.extension}`,
      Context:  'agent-ready',
      Exten:    's',
      Priority: '1',
      CallerID: 'MynxDialer <Dialer>',
      Timeout:  20000,
      Async:    'true',
      Account:  `agent_ready_${agent.id}`
    });
    console.log(`[Dialer] Agent audio check call sent to ${agent.full_name} (ext ${agent.extension})`);
  } catch (err) {
    console.warn('[Dialer] Agent ready call failed:', err.message);
  }
}

// ── Atomically claim an agent (prevents race condition) ───────────────────────
async function claimAgent(campaignId) {
  const agents = await query(
    `SELECT u.id, u.full_name, u.extension FROM users u
     JOIN agent_sessions s ON s.agent_id = u.id AND s.logged_out_at IS NULL
     WHERE s.campaign_id = ? AND s.status = 'available' AND u.status = 'available' AND u.active = 1
     ORDER BY u.status_changed_at ASC, u.id ASC LIMIT 1`,
    [campaignId]
  );
  if (!agents.length) return null;

  // Atomic claim: only succeeds if agent is still available
  const result = await query(
    "UPDATE users SET status = 'oncall' WHERE id = ? AND status = 'available'",
    [agents[0].id]
  );
  if (result.affectedRows === 0) return null; // beaten by another call

  await query(
    "UPDATE agent_sessions SET status = 'oncall' WHERE agent_id = ? AND logged_out_at IS NULL",
    [agents[0].id]
  );
  return agents[0];
}

// ── Auto-dispose abandoned call as "Call not Connected" ───────────────────────
async function abandonCall(callId, leadId) {
  try {
    // Get or create "Call not Connected" disposition
    let disp = await queryOne("SELECT id FROM dispositions WHERE code = 'CNC' LIMIT 1");
    if (!disp) {
      const r = await query(
        "INSERT IGNORE INTO dispositions (campaign_id, code, label, color, sort_order) VALUES (NULL, 'CNC', 'Call Not Connected', '#ff5252', 0)"
      );
      disp = { id: r.insertId };
    }

    await query(
      "UPDATE calls SET status = 'abandoned', hung_up_at = NOW(), disposition_id = ?, disposition_code = 'CNC' WHERE id = ?",
      [disp.id, callId]
    );
    await query(
      "UPDATE leads SET assigned_agent = NULL, last_disposition = 'CNC' WHERE id = ?",
      [leadId]
    );
  } catch (err) {
    console.error('[Dialer] abandonCall error:', err.message);
  }
}

// ── Main dialer cycle ─────────────────────────────────────────────────────────
// Keep AstDB (read by the lead-wait dialplan as ${DB(dialer/machine_linger)}) in
// sync with the admin setting "machine_linger_seconds" (answering-machine hold,
// seconds). Clamped 0–20, default 7. Pushed only when the value changes (and once
// after startup), so a Settings change takes effect on the next cycle (~seconds).
// This is the ONLY wiring needed — the dialplan reads AstDB directly, so the
// originate / call path is completely untouched.
let _lastLingerPushed = null;
async function syncMachineLinger(ami) {
  try {
    const r = await queryOne("SELECT value FROM system_settings WHERE key_name = 'machine_linger_seconds'");
    let v = parseInt(r && r.value);
    if (isNaN(v)) v = 7;
    v = Math.max(0, Math.min(v, 20));
    if (v !== _lastLingerPushed && ami && typeof ami.action === 'function') {
      _lastLingerPushed = v;
      ami.action({ Action: 'Command', Command: `database put dialer machine_linger ${v}` }).catch(() => {});
    }
  } catch (_) {}
}

async function runDialerCycle() {
  if (!engineRunning) return;
  const ami = getAMI();
  if (!SIMULATION && (!ami || !ami.isReady())) return;

  // Sync the admin-set machine-linger value into AstDB (cheap; only on change).
  await syncMachineLinger(ami);

  try {
    const campaigns = await query("SELECT * FROM campaigns WHERE status = 'active' AND (account_id IS NULL OR account_id NOT IN (SELECT id FROM accounts WHERE status = 'suspended'))");
    for (const c of campaigns) await processCampaign(c, ami);
  } catch (err) {
    console.error('[Dialer] Cycle error:', err.message);
  }
}

async function processCampaign(campaign, ami) {
  try {
    if (!isWithinTimeWindow(campaign)) return;
    if (campaign.dial_method === 'preview') return;

    const isPredictive = ['predictive', 'power'].includes(campaign.dial_method);

    // Available agents
    const agents = await query(
      `SELECT u.id, u.extension, u.full_name
       FROM users u
       JOIN agent_sessions s ON s.agent_id = u.id AND s.logged_out_at IS NULL
       WHERE s.campaign_id = ? AND s.status = 'available' AND u.status = 'available' AND u.active = 1`,
      [campaign.id]
    );
    if (agents.length === 0) return;
    // Available agents on this campaign — used to feed each one's "Live Dialing"
    // ticker (predictive calls aren't pre-assigned, so every available agent sees
    // the campaign's live dialing activity / dial level).
    campaign._agentIds = agents.map(a => a.id);

    // How many calls to originate this cycle. Predictive over-dials by ratio, but
    // we keep only (agents × ratio) calls in flight at once — subtract the ones
    // already ringing so we don't pile on every 3s tick.
    const ratio = parseFloat(campaign.dial_ratio) || 1.0;
    let totalCalls;
    if (isPredictive) {
      const inFlight = (await queryOne(
        "SELECT COUNT(*) AS c FROM calls WHERE campaign_id = ? AND status IN ('ringing','dialing') AND hung_up_at IS NULL",
        [campaign.id]
      ))?.c || 0;
      // Respect the admin's ratio (calls per available agent). Keep only a high
      // safety ceiling so a typo can't trigger a runaway dial storm.
      const MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT_CALLS) || 200;
      const target = Math.min(Math.ceil(agents.length * ratio), MAX_INFLIGHT);
      totalCalls = Math.max(0, target - inFlight);
    } else {
      totalCalls = agents.length; // progressive: 1:1
    }
    if (totalCalls === 0) return;

    // Pull leads from hopper (one per call slot)
    const leadsToCall = [];
    for (let i = 0; i < totalCalls; i++) {
      const lead = await getNextLead(campaign.id, campaign.max_attempts, campaign.account_id);
      if (!lead) break;
      if (pendingLeads.has(lead.id)) continue;

      // Reserve lead atomically
      const upd = await query(
        'UPDATE leads SET assigned_agent = -1 WHERE id = ? AND assigned_agent IS NULL',
        [lead.id]
      );
      if (upd.affectedRows === 0) continue;

      pendingLeads.add(lead.id);
      leadsToCall.push(lead);
      setTimeout(() => pendingLeads.delete(lead.id), 120000);
    }

    if (leadsToCall.length === 0) return;

    // Caller ID — must be a valid number for the trunk. The dialer-outbound
    // dialplan normalises 0x → 44x, so UK national format is fine here.
    // Using campaign.name as CLI was wrong (non-numeric → trunk rejects call).
    // Resolve which CID group this campaign rotates through. Prefer a group
    // assigned directly to this campaign, then one for ALL campaigns, preferring
    // a trunk match — falling back to the campaign's own cid_group_id. The actual
    // number is picked PER CALL below (not once per batch) so every CLI in the
    // group is used equally (true round-robin).
    let cidGroupId = null;
    try { cidGroupId = await resolveCidGroupForCampaign(campaign); } catch (_) {}

    // Which SIP provider (trunk) carries this campaign's calls. Resolved once per
    // tick; the dialplan dials `@${TRUNK}`, so we just hand it the right endpoint.
    // Unset/invalid → bare 'trunk_endpoint' (the default provider).
    try {
      const { endpointForTrunkId } = require('./pjsipConfig');
      campaign._trunkEndpoint = await endpointForTrunkId(campaign.sip_trunk_id);
    } catch (_) { campaign._trunkEndpoint = 'trunk_endpoint'; }

    console.log(`[Dialer] "${campaign.name}" → ${leadsToCall.length} calls (${agents.length} agents, ratio ${ratio}, mode: ${campaign.dial_method})`);

    // For progressive: pre-assign one agent per call
    // For predictive: no pre-assignment; agent claimed atomically at answer time
    for (let i = 0; i < leadsToCall.length; i++) {
      const lead  = leadsToCall[i];
      const agent = isPredictive ? null : (agents[i] || agents[0]);
      // Pick the next caller ID for THIS call (even round-robin across the group).
      let callerIdNum = '01234567890';
      if (cidGroupId) {
        try { const c = await getNextCID(cidGroupId); if (c) callerIdNum = c; } catch (_) {}
      }
      originateCall(campaign, lead, agent, callerIdNum, isPredictive, ami).catch(err =>
        console.error('[Dialer] originateCall error:', err.message)
      );
    }
  } catch (err) {
    console.error(`[Dialer] Campaign ${campaign.id} error:`, err.message);
  }
}

async function originateCall(campaign, lead, agent, callerIdNum, isPredictive, ami) {
  // For progressive: claim agent immediately
  if (!isPredictive && agent) {
    const claimed = await query(
      "UPDATE users SET status = 'oncall' WHERE id = ? AND status = 'available'",
      [agent.id]
    );
    if (claimed.affectedRows === 0) {
      // Agent was taken — free the lead and reset hopper so lead can be retried
      await query('UPDATE leads SET assigned_agent = NULL WHERE id = ?', [lead.id]);
      await query("UPDATE hopper SET status = 'ready' WHERE lead_id = ? AND campaign_id = ?", [lead.id, campaign.id]);
      return;
    }
    await query(
      "UPDATE agent_sessions SET status = 'oncall' WHERE agent_id = ? AND logged_out_at IS NULL",
      [agent.id]
    );
  }

  // Insert call record
  const callResult = await query(
    `INSERT INTO calls (campaign_id, lead_id, agent_id, caller_id, status, direction, called_at)
     VALUES (?, ?, ?, ?, 'ringing', 'outbound', NOW())`,
    [campaign.id, lead.id, agent?.id || null, callerIdNum]
  );
  const callId = callResult.insertId;

  await query(
    'UPDATE leads SET status = "called", last_attempt = NOW(), attempts = attempts + 1 WHERE id = ?',
    [lead.id]
  );

  // Notify admin live feed + assigned agent (so DialingTicker updates)
  const callStartedPayload = {
    call_id: callId, campaign_id: campaign.id, lead_id: lead.id,
    agent_id: agent?.id, phone: lead.phone
  };
  if (ioInstance) {
    ioInstance.to('admins').emit('call:started', callStartedPayload);
  }
  if (socketServiceInstance) {
    // Progressive: notify the pre-assigned agent. Predictive: notify every
    // available agent on the campaign so they all see the live dialing feed.
    const targets = agent ? [agent.id] : (campaign._agentIds || []);
    for (const aid of targets) {
      socketServiceInstance.broadcastToAgent(aid, 'call:started', callStartedPayload);
    }
  }

  if (SIMULATION) {
    await query('UPDATE calls SET channel = ? WHERE id = ?', [`SIM-${callId}`, callId]);

    const answers = Math.random() < SIM_ANSWER_RATE;
    const delay   = 2000 + Math.random() * 6000; // 2–8 second ring time

    if (!answers) {
      setTimeout(async () => {
        await query("UPDATE calls SET status = 'no_answer', hung_up_at = NOW() WHERE id = ?", [callId]).catch(() => {});
        await query('UPDATE leads SET assigned_agent = NULL WHERE id = ?', [lead.id]).catch(() => {});
        if (ioInstance) ioInstance.to('admins').emit('call:no_answer', { call_id: callId, phone: lead.phone });
      }, delay);
      return;
    }

    // Call "answered" — find available agent
    setTimeout(async () => {
      try {
        let assignedAgent = agent; // Already claimed for progressive

        if (isPredictive) {
          // Atomically claim an available agent
          assignedAgent = await claimAgent(campaign.id);

          if (!assignedAgent) {
            // No agent free → abandon + auto-dispose as "Call Not Connected"
            await abandonCall(callId, lead.id);
            if (ioInstance) ioInstance.to('admins').emit('call:abandoned', { call_id: callId, phone: lead.phone });
            console.log(`[Dialer] [SIM] Call ${callId} → ABANDONED (no agent) → ${lead.phone}`);
            return;
          }

        }

        // Connect call to agent
        await query(
          "UPDATE calls SET status = 'answered', answered_at = NOW(), agent_id = ? WHERE id = ?",
          [assignedAgent.id, callId]
        );
        await query('UPDATE leads SET assigned_agent = ? WHERE id = ?', [assignedAgent.id, lead.id]);

        // Notify agent
        if (socketServiceInstance) {
          socketServiceInstance.broadcastToAgent(assignedAgent.id, 'call:assigned', {
            call_id: callId, lead, caller_id: callerIdNum
          });
          socketServiceInstance.broadcastToAgent(assignedAgent.id, 'call:answered', { call_id: callId });
          socketServiceInstance.broadcastAgentStatus(assignedAgent.id, 'oncall', { campaign_id: campaign.id });
        }
        if (ioInstance) {
          ioInstance.to('admins').emit('call:answered', {
            call_id: callId, agent_id: assignedAgent.id, phone: lead.phone
          });
        }
        console.log(`[Dialer] [SIM] Call ${callId} CONNECTED → ${assignedAgent.full_name} → ${lead.phone}`);
      } catch (err) {
        console.error('[Dialer] [SIM] Answer handler error:', err.message);
      }
    }, delay);

  } else {
    // ── Real AMI originate ──────────────────────────────────────────
    // The DB stores the base channel name (used for hangup matching against the
    // ;1/;2 event channels). Originate with the "/n" modifier, which disables
    // Local-channel optimization: without it Asterisk collapses the two Local
    // halves mid-call, re-activating RTP and racing the agent leg's WebRTC DTLS
    // setup (ast_rtp_activate runs while ssl=(nil)) → leads connect but the agent
    // hears silence. "/n" keeps the media path stable so DTLS completes.
    const channelBase = `Local/${lead.phone}@dialer-outbound`;
    const channel = `${channelBase}/n`;
    try {
      if (agent) {
        if (socketServiceInstance) {
          socketServiceInstance.broadcastToAgent(agent.id, 'call:assigned', { call_id: callId, lead, caller_id: callerIdNum });
          socketServiceInstance.broadcastAgentStatus(agent.id, 'oncall', { campaign_id: campaign.id });
        }
      }
      // Predictive (no pre-assigned agent): dial the lead into the HOLDING context.
      // When the lead answers, the AMI DialEnd handler claims a free agent and
      // redirects the lead into that agent's room (or abandons after the timeout).
      // Progressive: dial straight into the pre-assigned agent's room.
      await ami.originate({
        channel,
        exten: agent?.extension || 's',
        // Predictive: hold context with AMD (lead-wait) or without (lead-wait-noamd)
        // per the campaign's "AMD enabled" setting. Progressive: straight to the room.
        context: agent ? 'dialer-bridge' : (campaign.amd_enabled ? 'lead-wait' : 'lead-wait-noamd'),
        callerid: `${lead.first_name || 'Lead'} <${callerIdNum}>`,
        timeout: 30000,
        variable: `CALL_ID=${callId},LEAD_ID=${lead.id},AGENT_ID=${agent?.id || 0},CAMPAIGN_ID=${campaign.id},TRUNK=${campaign._trunkEndpoint || 'trunk_endpoint'}`,
        async: true
      });
      await query('UPDATE calls SET channel = ? WHERE id = ?', [channelBase, callId]);
    } catch (err) {
      console.error(`[Dialer] Originate failed:`, err.message);
      await query("UPDATE calls SET status = 'failed', hung_up_at = NOW() WHERE id = ?", [callId]);
      await query('UPDATE leads SET assigned_agent = NULL, status = "failed" WHERE id = ?', [lead.id]);
      if (agent) {
        await query("UPDATE users SET status = 'available' WHERE id = ?", [agent.id]);
        await query("UPDATE agent_sessions SET status = 'available' WHERE agent_id = ? AND logged_out_at IS NULL", [agent.id]);
        if (socketServiceInstance) socketServiceInstance.broadcastAgentStatus(agent.id, 'available', {});
      }
    }
  }
}

async function getNextCID(groupId) {
  const group = await queryOne('SELECT rotation_type, last_used_index FROM caller_id_groups WHERE id = ?', [groupId]);
  if (!group) return null;
  const numbers = await query('SELECT number FROM caller_ids WHERE group_id = ? AND active = 1 ORDER BY id', [groupId]);
  if (!numbers.length) return null;
  if (group.rotation_type === 'random') {
    return numbers[Math.floor(Math.random() * numbers.length)].number;
  }
  const idx = (group.last_used_index || 0) % numbers.length;
  // Keep the cursor bounded so it advances one step per call (true round-robin).
  await query('UPDATE caller_id_groups SET last_used_index = ? WHERE id = ?', [(idx + 1) % numbers.length, groupId]);
  return numbers[idx].number;
}

// Pick the CID group a campaign should rotate through. Prefer a group assigned
// directly to this campaign, then one for ALL campaigns (campaign_id IS NULL),
// preferring a SIP-trunk match — only groups with active numbers. Falls back to
// the campaign's own cid_group_id (legacy campaign-side assignment).
async function resolveCidGroupForCampaign(campaign) {
  const rows = await query(
    `SELECT g.id FROM caller_id_groups g
     WHERE (g.campaign_id = ? OR g.campaign_id IS NULL)
       AND (g.account_id = ? OR ? IS NULL)
       AND EXISTS (SELECT 1 FROM caller_ids ci WHERE ci.group_id = g.id AND ci.active = 1)
     ORDER BY IF(g.campaign_id = ?, 1, 0) DESC,
              IF(g.sip_trunk_id = ?, 1, 0) DESC,
              g.id ASC
     LIMIT 1`,
    [campaign.id, campaign.account_id, campaign.account_id, campaign.id, campaign.sip_trunk_id || 0]
  );
  if (rows.length) return rows[0].id;
  return campaign.cid_group_id || null;
}

// ── PREDICTIVE: AMD said this answered call is a HUMAN ───────────────────────
// Fired by the lead-wait dialplan via a LeadHuman UserEvent (after AMD passes).
// leadChannel is the holding ;1 leg. Claim a free agent and AMI-Redirect that leg
// into the agent's room; if no agent frees up within ABANDON_MS, abandon it.
async function handleLeadHuman(call, leadChannel, ami, io, socketService) {
  if (!call || !ami || !leadChannel) return;
  await query(
    "UPDATE calls SET status = 'answered', answered_at = NOW() WHERE id = ? AND status NOT IN ('answered','abandoned','no_answer','machine')",
    [call.id]
  ).catch(() => {});
  await tryConnectAgent(call, leadChannel, ami, io, socketService, 0);
}

// ── PREDICTIVE: AMD detected an ANSWERING MACHINE ────────────────────────────
// Auto-dispose without ever bothering an agent; free the lead for a later pass.
async function handleLeadMachine(call, io) {
  if (!call) return;
  const callId = call.id;
  let disp = await queryOne("SELECT id FROM dispositions WHERE code = 'AMD' LIMIT 1").catch(() => null);
  if (!disp) {
    const r = await query(
      "INSERT IGNORE INTO dispositions (campaign_id, code, label, color, sort_order) VALUES (NULL, 'AMD', 'Answering Machine', '#9c27b0', 0)"
    ).catch(() => null);
    disp = r ? { id: r.insertId } : null;
  }
  await query(
    "UPDATE calls SET status = 'machine', hung_up_at = NOW(), disposition_id = ?, disposition_code = 'AMD' WHERE id = ?",
    [disp?.id || null, callId]
  ).catch(() => {});
  await query("UPDATE leads SET assigned_agent = NULL, status = 'called', last_disposition = 'AMD' WHERE id = ?", [call.lead_id]).catch(() => {});
  if (io) io.to('admins').emit('call:machine', { call_id: callId, phone: call.caller_id });
  console.log(`[Dialer] Call ${callId} → ANSWERING MACHINE — auto-disposed (not connected to agent)`);
}

async function tryConnectAgent(call, leadLeg, ami, io, socketService, elapsedMs) {
  // Stop if the lead hung up while holding
  const cur = await queryOne('SELECT status, hung_up_at FROM calls WHERE id = ?', [call.id]).catch(() => null);
  if (!cur || cur.hung_up_at || ['abandoned', 'no_answer'].includes(cur.status)) return;

  const agent = await claimAgent(call.campaign_id);
  if (agent) {
    try {
      // Move the holding lead into the claimed agent's conference room
      await ami.action({ Action: 'Redirect', Channel: leadLeg, Context: 'dialer-bridge', Exten: agent.extension, Priority: '1' });
    } catch (err) {
      // Lead likely gone — release the agent and stop
      await query("UPDATE users SET status = 'available' WHERE id = ?", [agent.id]).catch(() => {});
      await query("UPDATE agent_sessions SET status = 'available' WHERE agent_id = ? AND logged_out_at IS NULL", [agent.id]).catch(() => {});
      if (socketService) socketService.broadcastAgentStatus(agent.id, 'available', {});
      return;
    }
    const lead = await queryOne('SELECT * FROM leads WHERE id = ?', [call.lead_id]);
    leadChannels.set(Number(call.id), leadLeg);
    await query('UPDATE calls SET agent_id = ? WHERE id = ?', [agent.id, call.id]).catch(() => {});
    await query('UPDATE leads SET assigned_agent = ? WHERE id = ?', [agent.id, call.lead_id]).catch(() => {});

    // Record the conversation if the campaign has it enabled. MixMonitor on the
    // lead's leg captures BOTH sides (it's bridged to the agent's room). Saved to
    // the shared monitor volume as call_<id>.wav. Wrapped + non-blocking so a
    // recording hiccup can NEVER break the live connection.
    try {
      const camp = await queryOne('SELECT record_calls FROM campaigns WHERE id = ?', [call.campaign_id]);
      if (camp && camp.record_calls) {
        const recFile = `call_${call.id}.wav`;
        await ami.action({ Action: 'MixMonitor', Channel: leadLeg, File: `/var/spool/asterisk/monitor/${recFile}` });
        await query('UPDATE calls SET recording_file = ? WHERE id = ?', [recFile, call.id]).catch(() => {});
        console.log(`[Dialer] Recording started for call ${call.id} → ${recFile}`);
      }
    } catch (e) { console.warn('[Dialer] recording start failed (call continues):', e.message); }

    if (socketService) {
      socketService.broadcastToAgent(agent.id, 'call:assigned', { call_id: call.id, lead, caller_id: call.caller_id });
      socketService.broadcastToAgent(agent.id, 'call:answered', { call_id: call.id });
      socketService.broadcastAgentStatus(agent.id, 'oncall', { campaign_id: call.campaign_id });
    }
    if (io) io.to('admins').emit('call:answered', { call_id: call.id, agent_id: agent.id, phone: lead?.phone });
    console.log(`[Dialer] Lead ${call.lead_id} connected → ${agent.full_name} (room agent-${agent.extension})`);
    return;
  }

  // No free agent yet — keep the lead on hold and retry until the abandon window
  if (elapsedMs >= ABANDON_MS) {
    try { await ami.action({ Action: 'Hangup', Channel: leadLeg, Cause: '16' }); } catch (_) {}
    await abandonCall(call.id, call.lead_id);
    if (io) io.to('admins').emit('call:abandoned', { call_id: call.id });
    console.log(`[Dialer] Call ${call.id} ABANDONED — no agent within ${ABANDON_MS}ms (lead freed for recycle)`);
    return;
  }
  setTimeout(() => tryConnectAgent(call, leadLeg, ami, io, socketService, elapsedMs + 1000).catch(() => {}), 1000);
}

// ── PREDICTIVE: a dialed lead did NOT answer ─────────────────────────────────
async function handleLeadNoAnswer(dialChannel, io) {
  const base = dialChannel.replace(/;[12]$/, '').replace(/-[0-9a-f]+$/i, '');
  const call = await queryOne(
    "SELECT * FROM calls WHERE channel = ? AND status IN ('ringing','dialing') AND hung_up_at IS NULL ORDER BY called_at DESC LIMIT 1",
    [base]
  );
  if (!call) return;
  await query("UPDATE calls SET status = 'no_answer', hung_up_at = NOW() WHERE id = ?", [call.id]).catch(() => {});
  await query("UPDATE leads SET assigned_agent = NULL, status = 'called', last_disposition = 'NA' WHERE id = ?", [call.lead_id]).catch(() => {});
  if (io) io.to('admins').emit('call:no_answer', { call_id: call.id, phone: call.caller_id });
}

// ── Self-heal stuck connected calls ───────────────────────────────────────────
// When a lead is connected to an agent but the agent vanishes before disposing
// (browser reload/crash/logout, network drop), the normal disposition cleanup —
// which frees the lead and the agent — never runs, so the lead sits orphaned in
// 'called' (assigned_agent set, so it's never re-dialed) and the agent stays
// 'oncall'. This reaper finds those and runs the same cleanup the disposition
// route would, so the system recovers on its own.
const REAP_WRAPUP_SECONDS = parseInt(process.env.REAP_WRAPUP_SECONDS) || 90;
async function reapStuckCalls() {
  try {
    const stuck = await query(
      `SELECT id, lead_id, agent_id FROM calls
       WHERE agent_id IS NOT NULL
         AND disposition_id IS NULL
         AND status = 'answered'
         AND (
              (hung_up_at IS NOT NULL AND hung_up_at < NOW() - INTERVAL ? SECOND)
           OR (hung_up_at IS NULL AND answered_at < NOW() - INTERVAL 60 MINUTE)
         )`,
      [REAP_WRAPUP_SECONDS]
    );
    for (const c of stuck) {
      // If the agent is still connected (browser open), they're just taking
      // their time to disposition — NOT vanished. Leave them in wrap-up with
      // unlimited time; never force-advance a present agent (this is what was
      // silently stamping real sales as NODISPO after 90s). Only genuinely
      // disconnected agents fall through to the reap/recover logic below.
      if (socketServiceInstance && socketServiceInstance.isAgentConnected(c.agent_id)) {
        continue;
      }
      await query(
        "UPDATE calls SET status='abandoned', disposition_code='NODISPO', hung_up_at=IFNULL(hung_up_at, NOW()) WHERE id=?",
        [c.id]
      );
      if (c.lead_id) {
        // Clear the assignment so it's dialable again (status 'called' is eligible);
        // attempts were already counted at dial time, so don't double-count.
        await query("UPDATE leads SET assigned_agent=NULL, last_disposition='NODISPO' WHERE id=?", [c.lead_id]);
      }
      // Free the agent only if they're still flagged oncall (no-op if offline).
      await query("UPDATE users SET status='available' WHERE id=? AND status='oncall'", [c.agent_id]);
      await query("UPDATE agent_sessions SET status='available' WHERE agent_id=? AND logged_out_at IS NULL AND status='oncall'", [c.agent_id]);
      if (socketServiceInstance) {
        try { socketServiceInstance.broadcastToAgent(c.agent_id, 'call:hangup', { call_id: c.id, reaped: true }); } catch (_) {}
        try { socketServiceInstance.broadcastAgentStatus(c.agent_id, 'available', {}); } catch (_) {}
      }
      console.log(`[Dialer] Reaped stuck call ${c.id} (lead ${c.lead_id}, agent ${c.agent_id}) — lead freed for recycle, agent released`);
    }
  } catch (err) {
    console.error('[Dialer] reapStuckCalls error:', err.message);
  }
}

// Hopper leak guard: a lead is flipped to 'dialing' when the dialer claims it, but
// nothing clears that row after the call ends — so over time leads accumulate in
// 'dialing' forever (claimed but not being called), inflating "dialing now" and
// trapping leads. Periodically delete 'dialing' rows whose lead has NO active call
// and no call in the last few minutes (= genuinely stuck). The hopper refill re-
// queues any still-dialable lead as 'ready'. The 3-minute window protects a lead
// that was just claimed / is ringing, so we never disturb a real in-flight call.
async function reapStuckHopper() {
  try {
    const r = await query(
      `DELETE FROM hopper
       WHERE status = 'dialing'
         AND lead_id NOT IN (
           SELECT lead_id FROM calls
           WHERE lead_id IS NOT NULL
             AND (hung_up_at IS NULL OR called_at > NOW() - INTERVAL 3 MINUTE)
         )`
    );
    if (r && r.affectedRows) console.log(`[Dialer] Reaped ${r.affectedRows} stuck hopper 'dialing' lead(s)`);
  } catch (err) {
    console.error('[Dialer] reapStuckHopper error:', err.message);
  }
}

function initDialerEngine(io, socketService) {
  ioInstance           = io;
  socketServiceInstance = socketService;
  engineRunning        = true;
  const interval       = parseInt(process.env.DIALER_INTERVAL) || 3000;
  if (SIMULATION) console.log(`[Dialer] *** SIMULATION MODE ON (answer_rate: ${Math.round(SIM_ANSWER_RATE * 100)}%) ***`);
  console.log(`[Dialer] Engine started — interval: ${interval}ms`);
  setInterval(runDialerCycle, interval);
  setInterval(checkCallbacks, 30000);
  setInterval(reapStuckCalls, 15000);
  setInterval(reapStuckHopper, 60000);
}

async function checkCallbacks() {
  try {
    const due = await query(
      `SELECT cb.*, l.phone, l.first_name, l.last_name
       FROM callbacks cb JOIN leads l ON l.id = cb.lead_id
       WHERE cb.status = 'pending' AND cb.scheduled_at <= NOW() LIMIT 20`
    );
    for (const cb of due) {
      if (socketServiceInstance && cb.agent_id) {
        socketServiceInstance.broadcastToAgent(cb.agent_id, 'callback:due', {
          callback_id: cb.id,
          lead: { id: cb.lead_id, phone: cb.phone, first_name: cb.first_name, last_name: cb.last_name },
          notes: cb.notes
        });
      }
    }
  } catch (err) { console.error('[Dialer] Callback error:', err.message); }
}

module.exports = { initDialerEngine, handleLeadHuman, handleLeadMachine, handleLeadNoAnswer, getLeadChannel, clearLeadChannel };