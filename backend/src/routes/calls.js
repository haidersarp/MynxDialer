const express = require('express');
const fs = require('fs');
const path = require('path');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { getAMI } = require('../services/amiClient');
const { getSocketService } = require('../services/socketService');
const { campaignClause, getOwnedCall, getOwnedUser, getOwnedCampaign, getOwnedLead } = require('../middleware/tenant');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { campaign_id, agent_id, status, date_from, date_to, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = ['1=1'];
    const params = [];

    if (campaign_id) { where.push('c.campaign_id = ?'); params.push(campaign_id); }
    if (agent_id) { where.push('c.agent_id = ?'); params.push(agent_id); }
    if (status) { where.push('c.status = ?'); params.push(status); }
    if (date_from) { where.push('c.called_at >= ?'); params.push(date_from); }
    if (date_to) { where.push('c.called_at <= ?'); params.push(date_to + ' 23:59:59'); }
    const _cc = campaignClause(req, 'c');
    if (_cc.clause) { where.push(_cc.clause.replace(/^ AND /, '')); params.push(..._cc.params); }

    const countRow = await queryOne(
      `SELECT COUNT(*) as total FROM calls c WHERE ${where.join(' AND ')}`, params
    );

    const calls = await query(
      `SELECT c.*, u.full_name as agent_name, ca.name as campaign_name,
       l.first_name, l.last_name, l.phone as lead_phone,
       d.label as disposition_label, d.color as disposition_color
       FROM calls c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.called_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ calls, total: countRow.total, page: parseInt(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/active', authenticate, async (req, res) => {
  try {
    const _ac = campaignClause(req, 'c');
    const calls = await query(
      `SELECT c.*, u.full_name as agent_name, l.first_name, l.last_name, l.phone as lead_phone
       FROM calls c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE c.hung_up_at IS NULL AND c.status IN ('ringing', 'answered') ${_ac.clause}`,
      _ac.params
    );
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a call record for an agent's MANUAL dial so it can be dispositioned
// like any other call. The browser places the actual SIP audio; this just logs
// the call and (optionally) links the matched lead. Campaign is derived from the
// agent's active session so no cross-account campaign can be spoofed.
router.post('/manual', authenticate, async (req, res) => {
  try {
    const { phone, lead_id } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const sess = await queryOne(
      "SELECT campaign_id FROM agent_sessions WHERE agent_id = ? AND logged_out_at IS NULL ORDER BY id DESC LIMIT 1",
      [req.user.id]
    );
    const campaignId = sess && sess.campaign_id;
    if (!campaignId) return res.status(400).json({ error: 'No active campaign session' });
    if (!(await getOwnedCampaign(req, campaignId))) return res.status(404).json({ error: 'Campaign not found' });

    let leadId = null, lead = null;
    if (lead_id) {
      lead = await getOwnedLead(req, lead_id);
      if (lead) { leadId = lead.id; delete lead._acct; }
    }

    const clean = String(phone).replace(/\D/g, '').slice(0, 20);
    const result = await query(
      `INSERT INTO calls (campaign_id, lead_id, agent_id, caller_id, status, direction, called_at, answered_at)
       VALUES (?, ?, ?, ?, 'answered', 'outbound', NOW(), NOW())`,
      [campaignId, leadId, req.user.id, clean]
    );
    res.status(201).json({ call_id: result.insertId, lead });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/disposition', authenticate, async (req, res) => {
  try {
    const { disposition_id, notes, callback_at } = req.body;
    const callId = req.params.id;

    const call = await getOwnedCall(req, callId);
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const disp = await queryOne('SELECT * FROM dispositions WHERE id = ?', [disposition_id]);

    await query(
      'UPDATE calls SET disposition_id = ?, disposition_code = ?, notes = ?, hung_up_at = IFNULL(hung_up_at, NOW()) WHERE id = ?',
      [disposition_id, disp ? disp.code : null, notes || null, callId]
    );

    if (call.lead_id) {
      let leadStatus = 'called';
      if (disp) {
        if (disp.is_sale) leadStatus = 'completed';
        else if (disp.is_dnc) leadStatus = 'dnc';
        else if (disp.is_callback) leadStatus = 'callback';
        else if (disp.code === 'NA') leadStatus = 'no_answer';
        else if (disp.code === 'BUSY') leadStatus = 'busy';
      }

      await query(
        'UPDATE leads SET status = ?, last_disposition = ?, assigned_agent = NULL, attempts = attempts + 1, last_attempt = NOW() WHERE id = ?',
        [leadStatus, disp ? disp.code : null, call.lead_id]
      );

      if (disp && disp.is_dnc) {
        await query(
          'INSERT IGNORE INTO dnc_list (phone, account_id, added_by, reason) SELECT phone, (SELECT account_id FROM campaigns WHERE id = ?), ?, ? FROM leads WHERE id = ?',
          [call.campaign_id, req.user.id, 'Disposition DNC', call.lead_id]
        );
      }

      if (disp && disp.is_callback && callback_at) {
        await query(
          'INSERT INTO callbacks (lead_id, agent_id, campaign_id, scheduled_at, notes) VALUES (?, ?, ?, ?, ?)',
          [call.lead_id, req.user.id, call.campaign_id, callback_at, notes || null]
        );
        await query('UPDATE leads SET callback_at = ? WHERE id = ?', [callback_at, call.lead_id]);
      }
    }

    // ── Fix auto-dial: reset both users AND agent_sessions ──
    await query('UPDATE users SET status = "available" WHERE id = ? AND status = "oncall"', [req.user.id]);
    await query('UPDATE agent_sessions SET status = "available" WHERE agent_id = ? AND logged_out_at IS NULL', [req.user.id]);

    // Clean up hopper entry for this call
    if (call.lead_id) {
      await query('DELETE FROM hopper WHERE lead_id = ? AND campaign_id = ?', [call.lead_id, call.campaign_id]).catch(() => {});
    }

    const socketService = getSocketService();
    if (socketService) {
      socketService.broadcastAgentStatus(req.user.id, 'available', {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/hangup', authenticate, async (req, res) => {
  try {
    const call = await getOwnedCall(req, req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const ami = getAMI();
    if (ami) {
      // Prefer the REAL lead channel captured when the lead was bridged into the
      // agent's room — hanging that up kicks the lead out (the base channel name
      // stored in the DB never matches the live ;1/;2 channel). Fall back to the
      // stored channel for calls that never reached the conference.
      let chan = null;
      try { chan = require('../services/dialerEngine').getLeadChannel(call.id); } catch (_) {}
      chan = chan || call.channel;
      if (chan) {
        try { await ami.hangup(chan); } catch (_) { /* channel already gone */ }
      }
      try { require('../services/dialerEngine').clearLeadChannel(call.id); } catch (_) {}
    }

    if (!call.hung_up_at) {
      await query(
        "UPDATE calls SET status = IF(status = 'ringing' OR status = 'answered', 'abandoned', status), hung_up_at = NOW() WHERE id = ?",
        [call.id]
      );
      if (call.lead_id) {
        await query('UPDATE leads SET assigned_agent = NULL WHERE id = ?', [call.lead_id]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/transfer', authenticate, async (req, res) => {
  try {
    const { extension } = req.body;
    const call = await getOwnedCall(req, req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const ami = getAMI();
    if (ami && call.channel) {
      await ami.transfer(call.channel, extension, 'from-internal');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/hold', authenticate, async (req, res) => {
  try {
    const { hold } = req.body;
    const call = await getOwnedCall(req, req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });

    const ami = getAMI();
    if (ami && call.channel) {
      await ami.setVar(call.channel, 'HOLD', hold ? '1' : '0');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/park', authenticate, async (req, res) => {
  try {
    const call = await getOwnedCall(req, req.params.id);
    if (!call || !call.channel) return res.status(404).json({ error: 'Call not found' });

    const ami = getAMI();
    if (ami) {
      const lot = await ami.park(call.channel, call.agent_channel || call.channel);
      res.json({ success: true, lot });
    } else {
      res.status(503).json({ error: 'AMI not connected' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recording stream ─────────────────────────────────────────────────────────
router.get('/:id/recording', authenticate, async (req, res) => {
  try {
    const call = await getOwnedCall(req, req.params.id);
    if (!call?.recording_file) return res.status(404).json({ error: 'No recording for this call' });

    const filePath = call.recording_file.startsWith('/') ? call.recording_file
      : path.join('/var/spool/asterisk/monitor', call.recording_file);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Recording file not found on disk' });

    const stat = fs.statSync(filePath);
    const ext  = path.extname(filePath).toLowerCase();
    const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/wav';
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   mime
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All recordings (for recordings library) ───────────────────────────────────
router.get('/recordings/list', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { search, agent_id, date_from, date_to, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where  = ["c.recording_file IS NOT NULL AND c.recording_file != ''"];
    const params = [];

    if (agent_id)  { where.push('c.agent_id = ?');            params.push(agent_id); }
    if (date_from) { where.push('DATE(c.called_at) >= ?');     params.push(date_from); }
    if (date_to)   { where.push('DATE(c.called_at) <= ?');     params.push(date_to); }
    if (search) {
      where.push('(l.phone LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ? OR u.full_name LIKE ? OR u.extension LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    const _cc2 = campaignClause(req, 'c');
    if (_cc2.clause) { where.push(_cc2.clause.replace(/^ AND /, '')); params.push(..._cc2.params); }
    const countRow = await queryOne(
      `SELECT COUNT(*) as total FROM calls c LEFT JOIN leads l ON l.id = c.lead_id LEFT JOIN users u ON u.id = c.agent_id WHERE ${where.join(' AND ')}`,
      params
    );

    const recordings = await query(
      `SELECT c.id, c.called_at, c.duration, c.recording_file, c.status,
       u.full_name as agent_name, u.extension as agent_extension, u.id as agent_id,
       l.phone, l.first_name, l.last_name,
       d.label as disposition_label, d.color as disposition_color,
       ca.name as campaign_name
       FROM calls c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.called_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ recordings, total: countRow.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Call Monitoring (Listen / Barge / Whisper) ────────────────────────────────
router.post('/monitor', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { agent_id, mode } = req.body;
    if (!['listen', 'barge', 'whisper'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use: listen, barge, whisper' });
    }

    // The agent we want to monitor (need their SIP extension to spy).
    const agent = await getOwnedUser(req, agent_id);
    if (!agent?.extension) {
      return res.status(404).json({ error: 'Agent has no SIP extension' });
    }

    // Audio is delivered BROWSER-INITIATED: the admin's own SIP client (in the
    // Live Monitor page) dials the ChanSpy feature code *55/*56/*57<agentExt>.
    // That avoids the server-initiated DTLS race that breaks WebRTC here — the
    // same reason agents join their room via *88 rather than being dialed.
    // We only validate + broadcast here; the dial target is returned for the UI.
    const prefix = mode === 'whisper' ? '*56' : mode === 'barge' ? '*57' : '*55';
    const dialTarget = `${prefix}${agent.extension}`;

    const socketService = getSocketService();
    if (socketService) {
      socketService.broadcastToAdmins('monitor:started', {
        mode, agent_id, supervisor_id: req.user.id,
        supervisor_name: req.user.full_name || req.user.username,
        agent_extension: agent.extension,
      });
    }

    res.json({ success: true, mode, agent_extension: agent.extension, dial_target: dialTarget });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/monitor/stop', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { agent_id } = req.body;
    if (agent_id && !(await getOwnedUser(req, agent_id))) return res.status(404).json({ error: 'Agent not found' });
    const socketService = getSocketService();
    if (socketService) {
      socketService.broadcastToAdmins('monitor:stopped', { agent_id, supervisor_id: req.user.id });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
