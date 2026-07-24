// ─────────────────────────────────────────────────────────────────────────────
// trainee.js — Trainee portal API (listen-only shadowing).
//
// A trainee can do exactly four things, and nothing else:
//   1. See which agents in THEIR account are logged in, and silently listen
//   2. Write notes while shadowing
//   3. See the lead sheet of the call the shadowed agent is on (phone MASKED)
//   4. Read that campaign's script
//
// Trainees can never be heard. That is enforced in the Asterisk dialplan
// ([from-trainee] carries only *55 silent ChanSpy, no whisper/barge/outbound)
// and in pjsipConfig.buildTraineeEndpoints(), NOT here. This file only decides
// WHICH agent a trainee may point that listen at, and what data comes back.
//
// Every query is account-scoped: a trainee cannot see or listen to agents,
// leads or scripts belonging to another tenant.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { accountClause, accountId } = require('../middleware/tenant');
const { getSocketService } = require('../services/socketService');

const router = express.Router();

const onlyTrainee = [authenticate, requireRole('trainee')];
// Admins review what trainees wrote; super_admin sees across accounts.
const noteReviewers = [authenticate, requireRole('admin', 'supervisor', 'super_admin')];

// Mask a phone for trainee eyes: keep enough to follow the call, hide enough
// that a trainee cannot walk away with a customer list. 07123456789 → 071****789
function maskPhone(phone) {
  if (!phone) return null;
  const s = String(phone).trim();
  if (s.length <= 6) return '*'.repeat(s.length);
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(3, s.length - 6))}${s.slice(-3)}`;
}

// Load an agent only if they are in the trainee's account. Returns null
// otherwise, so a trainee cannot listen across tenants by guessing ids.
async function getListenableAgent(req, agentId) {
  if (!agentId) return null;
  const ac = accountClause(req, 'u');
  return await queryOne(
    `SELECT u.id, u.username, u.full_name, u.extension, u.status, u.account_id
     FROM users u
     WHERE u.id = ? AND u.active = 1 AND u.role IN ('agent','supervisor') ${ac.clause}`,
    [agentId, ...ac.params]
  );
}

// ── 1. Who can I shadow right now? ──────────────────────────────────────────
// Mirrors the admin /agents/live query (proven), minus anything a trainee has
// no business seeing. on_call drives the "listening now" state in the UI.
router.get('/agents', ...onlyTrainee, async (req, res) => {
  try {
    const ac = accountClause(req, 'u');
    const agents = await query(
      `SELECT u.id, u.username, u.full_name, u.extension, u.status,
              c.name AS campaign_name,
              cl.id AS call_id,
              cl.answered_at,
              (cl.id IS NOT NULL) AS on_call
       FROM users u
       LEFT JOIN agent_sessions s ON s.id = (
         SELECT id FROM agent_sessions
         WHERE agent_id = u.id AND logged_out_at IS NULL
         ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN campaigns c ON c.id = s.campaign_id
       LEFT JOIN calls cl ON cl.id = (
         SELECT id FROM calls
         WHERE agent_id = u.id AND hung_up_at IS NULL AND status = 'answered'
         ORDER BY called_at DESC LIMIT 1
       )
       WHERE u.role IN ('agent','supervisor')
         AND u.active = 1
         AND u.extension IS NOT NULL AND u.extension <> ''
         AND u.status <> 'offline'
         ${ac.clause}
       ORDER BY (cl.id IS NOT NULL) DESC, u.full_name`,
      ac.params
    );
    res.json(agents.map(a => ({ ...a, on_call: !!a.on_call })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2. Start listening ──────────────────────────────────────────────────────
// Returns the feature code the trainee's own browser dials. Audio is
// BROWSER-INITIATED (same as admin Live Monitor) — the server never dials the
// trainee, which is what keeps DTLS reliable here. We only validate + notify.
//
// This does NOT touch the agent's call in any way. ChanSpy attaches a passive
// read-only tap; the agent and customer are not signalled and hear nothing.
router.post('/listen', ...onlyTrainee, async (req, res) => {
  try {
    const { agent_id } = req.body;
    const agent = await getListenableAgent(req, agent_id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.extension) return res.status(400).json({ error: 'Agent has no SIP extension' });

    // *55 ONLY. There is deliberately no way to request whisper or barge from
    // this endpoint — and even if this returned *56/*57, [from-trainee] has no
    // such extensions and would reject the dial.
    const dialTarget = `*55${agent.extension}`;

    const socketService = getSocketService();
    if (socketService) {
      socketService.traineeWatch(req.user.id, agent.id);
      socketService.broadcastToAdmins('trainee:listening', {
        trainee_id: req.user.id,
        trainee_name: req.user.full_name || req.user.username,
        agent_id: agent.id,
        agent_name: agent.full_name || agent.username,
      });
    }

    res.json({
      success: true,
      mode: 'listen',
      agent_id: agent.id,
      agent_name: agent.full_name || agent.username,
      agent_extension: agent.extension,
      dial_target: dialTarget,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/listen/stop', ...onlyTrainee, async (req, res) => {
  try {
    const { agent_id } = req.body;
    const socketService = getSocketService();
    if (socketService) {
      socketService.traineeUnwatch(req.user.id);
      socketService.broadcastToAdmins('trainee:stopped', {
        trainee_id: req.user.id, agent_id: agent_id || null,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3 + 4. Lead sheet + script for whoever the agent is currently on ────────
// One call so the trainee's panel stays in sync with the agent's screen.
// Phone is masked; email/address are withheld entirely.
router.get('/agents/:id/context', ...onlyTrainee, async (req, res) => {
  try {
    const agent = await getListenableAgent(req, req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const call = await queryOne(
      `SELECT id, lead_id, campaign_id, answered_at, called_at
       FROM calls
       WHERE agent_id = ? AND hung_up_at IS NULL AND status = 'answered'
       ORDER BY called_at DESC LIMIT 1`,
      [agent.id]
    );

    if (!call) {
      // Agent is logged in but not on a live call — still hand back the script
      // for their current campaign so the trainee can read ahead.
      const sess = await queryOne(
        `SELECT c.script, c.name AS campaign_name
         FROM agent_sessions s JOIN campaigns c ON c.id = s.campaign_id
         WHERE s.agent_id = ? AND s.logged_out_at IS NULL
         ORDER BY s.id DESC LIMIT 1`,
        [agent.id]
      );
      return res.json({
        on_call: false, lead: null,
        script: sess ? sess.script : null,
        campaign_name: sess ? sess.campaign_name : null,
      });
    }

    const lead = call.lead_id
      ? await queryOne(
          `SELECT id, first_name, last_name, phone, city, state, zip,
                  status, attempts, last_disposition, custom_fields
           FROM leads WHERE id = ?`, [call.lead_id])
      : null;

    const campaign = call.campaign_id
      ? await queryOne('SELECT name, script FROM campaigns WHERE id = ?', [call.campaign_id])
      : null;

    res.json({
      on_call: true,
      call_id: call.id,
      answered_at: call.answered_at,
      // Masked + trimmed on purpose: a trainee needs context to learn, not a
      // exportable customer record. email/address are never sent.
      lead: lead ? {
        id: lead.id,
        first_name: lead.first_name,
        last_name: lead.last_name,
        phone_masked: maskPhone(lead.phone),
        city: lead.city, state: lead.state, zip: lead.zip,
        status: lead.status, attempts: lead.attempts,
        last_disposition: lead.last_disposition,
        custom_fields: lead.custom_fields || null,
      } : null,
      script: campaign ? campaign.script : null,
      campaign_name: campaign ? campaign.name : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2b. Notes ───────────────────────────────────────────────────────────────
router.get('/notes', ...onlyTrainee, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, agent_id, agent_name, call_id, lead_id, note, created_at, updated_at
       FROM trainee_notes WHERE trainee_id = ?
       ORDER BY created_at DESC LIMIT 500`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/notes', ...onlyTrainee, async (req, res) => {
  try {
    const { note, agent_id, call_id, lead_id, agent_name } = req.body;
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'Note is empty' });

    const result = await query(
      `INSERT INTO trainee_notes
       (trainee_id, account_id, agent_id, call_id, lead_id, agent_name, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, accountId(req), agent_id || null, call_id || null,
       lead_id || null, agent_name || null, String(note).trim()]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notes/:id', ...onlyTrainee, async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'Note is empty' });
    // trainee_id in the WHERE is the ownership check — a trainee can only ever
    // edit their own notes, even with a guessed id.
    const r = await query(
      'UPDATE trainee_notes SET note = ? WHERE id = ? AND trainee_id = ?',
      [String(note).trim(), req.params.id, req.user.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/notes/:id', ...onlyTrainee, async (req, res) => {
  try {
    const r = await query(
      'DELETE FROM trainee_notes WHERE id = ? AND trainee_id = ?',
      [req.params.id, req.user.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin-side review of trainee notes ──────────────────────────────────────
router.get('/notes/review/all', ...noteReviewers, async (req, res) => {
  try {
    const ac = accountClause(req, 'n');
    const rows = await query(
      `SELECT n.id, n.note, n.created_at, n.agent_name, n.call_id, n.lead_id,
              t.full_name AS trainee_name, t.username AS trainee_username
       FROM trainee_notes n
       JOIN users t ON t.id = n.trainee_id
       WHERE 1=1 ${ac.clause}
       ORDER BY n.created_at DESC LIMIT 1000`,
      ac.params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
