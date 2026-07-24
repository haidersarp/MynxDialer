const express = require('express');
const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { getSocketService } = require('../services/socketService');
const { accountClause, accountId, getOwnedUser, getOwnedCampaign } = require('../middleware/tenant');

const router = express.Router();

router.get('/', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const ac = accountClause(req, 'u');
    const agents = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.extension, u.status, u.active, u.created_at,
       s.campaign_id, s.status as session_status, s.pause_code_id,
       c.name as campaign_name
       FROM users u
       LEFT JOIN agent_sessions s ON s.agent_id = u.id AND s.logged_out_at IS NULL
       LEFT JOIN campaigns c ON c.id = s.campaign_id
       WHERE u.role IN ('agent','supervisor') ${ac.clause}
       ORDER BY u.full_name`,
      ac.params
    );
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/live', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const ac = accountClause(req, 'u');
    // Use correlated subquery to get only the LATEST session per user (prevents duplicates)
    const agents = await query(
      `SELECT u.id, u.username, u.full_name, u.extension, u.status,
       s.campaign_id, s.status as session_status, s.pause_code_id, s.logged_in_at,
       c.name as campaign_name,
       pc.label as pause_label,
       cl.caller_id, cl.called_at, cl.answered_at, cl.channel
       FROM users u
       LEFT JOIN agent_sessions s ON s.id = (
         SELECT id FROM agent_sessions
         WHERE agent_id = u.id AND logged_out_at IS NULL
         ORDER BY id DESC LIMIT 1
       )
       LEFT JOIN campaigns c ON c.id = s.campaign_id
       LEFT JOIN pause_codes pc ON pc.id = s.pause_code_id
       LEFT JOIN calls cl ON cl.id = (
         SELECT id FROM calls
         WHERE agent_id = u.id AND hung_up_at IS NULL AND status = 'answered'
         ORDER BY called_at DESC LIMIT 1
       )
       WHERE u.role IN ('agent','supervisor') AND u.active = 1 ${ac.clause}
       ORDER BY u.full_name`,
      ac.params
    );
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const a = await getOwnedUser(req, req.params.id);
    if (!a) return res.status(404).json({ error: 'Agent not found' });
    res.json({
      id: a.id, username: a.username, email: a.email, full_name: a.full_name,
      role: a.role, extension: a.extension, status: a.status, active: a.active, created_at: a.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pre-provisioned SIP endpoint pool in pjsip.conf (each [<ext>] auth password is
// `agent_sip_pass_<ext>`). Keep these in sync if the pjsip.conf pool changes.
// (Per-account extension ranges arrive in Phase 5 — extensions are a global namespace.)
const SIP_POOL_START = 1001, SIP_POOL_END = 1030;

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { username, password, email, full_name, role } = req.body;
    let { extension, sip_password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Login is by username, so it stays globally unique across accounts.
    const existing = await queryOne('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    // A tenant admin can only create agents/supervisors (not other admins/super_admins).
    const newRole = ['agent', 'supervisor'].includes(role) ? role : 'agent';

    // Auto-assign the next free SIP extension from the pool (extensions are global).
    // Per-account extension block (falls back to the global pool if unset).
    const _acctRange = await queryOne('SELECT ext_range_start, ext_range_end FROM accounts WHERE id = ?', [accountId(req)]);
    const _poolStart = (_acctRange && _acctRange.ext_range_start) || SIP_POOL_START;
    const _poolEnd   = (_acctRange && _acctRange.ext_range_end)   || SIP_POOL_END;
    if (!extension) {
      const used = await query('SELECT extension FROM users WHERE extension IS NOT NULL');
      const taken = new Set(used.map(u => String(u.extension)));
      for (let e = _poolStart; e <= _poolEnd; e++) {
        if (!taken.has(String(e))) { extension = String(e); break; }
      }
      if (!extension) {
        return res.status(400).json({ error: `No free SIP extensions left in this account's range (${_poolStart}-${_poolEnd}).` });
      }
    }
    const extNum = parseInt(extension);
    if (!sip_password && extNum >= 1001 && extNum <= 1999) {
      sip_password = `agent_sip_pass_${extension}`;
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (username, password, email, full_name, role, extension, sip_password, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [username, hash, email || null, full_name || username, newRole, extension || null, sip_password || null, accountId(req)]
    );
    res.status(201).json({ id: result.insertId, username, extension });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedUser(req, req.params.id))) return res.status(404).json({ error: 'Agent not found' });
    const { email, full_name, role, extension, sip_password, active, password } = req.body;
    const fields = [];
    const vals = [];

    if (email !== undefined) { fields.push('email = ?'); vals.push(email); }
    if (full_name !== undefined) { fields.push('full_name = ?'); vals.push(full_name); }
    // A tenant admin can only set agent/supervisor roles (no privilege escalation).
    if (role !== undefined) {
      const safeRole = ['agent', 'supervisor'].includes(role) ? role
        : (req.user.role === 'super_admin' ? role : undefined);
      if (safeRole !== undefined) { fields.push('role = ?'); vals.push(safeRole); }
    }
    if (extension !== undefined) {
      fields.push('extension = ?'); vals.push(extension);
      const extNum = parseInt(extension);
      if (sip_password === undefined && extNum >= 1001 && extNum <= 1999) {
        fields.push('sip_password = ?'); vals.push(`agent_sip_pass_${extension}`);
      }
    }
    if (sip_password !== undefined) { fields.push('sip_password = ?'); vals.push(sip_password); }
    if (active !== undefined) { fields.push('active = ?'); vals.push(active); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      fields.push('password = ?'); vals.push(hash);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedUser(req, req.params.id))) return res.status(404).json({ error: 'Agent not found' });
    await query('UPDATE users SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, pause_code_id, campaign_id } = req.body;
    const agentId = req.params.id;
    if (status === 'available' && req.user.account_status === 'suspended') return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });

    if (req.user.id !== parseInt(agentId)) {
      if (!['admin', 'supervisor'].includes(req.user.role))
        return res.status(403).json({ error: 'Cannot modify other agent status' });
      if (!(await getOwnedUser(req, agentId))) return res.status(404).json({ error: 'Agent not found' });
    }

    await query('UPDATE users SET status = ? WHERE id = ?', [status, agentId]);

    if (status === 'available' || status === 'paused') {
      const updated = await query(
        'UPDATE agent_sessions SET status = ?, pause_code_id = ? WHERE agent_id = ? AND logged_out_at IS NULL',
        [status, pause_code_id || null, agentId]
      );
      if (updated.affectedRows === 0) {
        const lastSession = await queryOne(
          'SELECT campaign_id FROM agent_sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1',
          [agentId]
        );
        const cid = campaign_id || lastSession?.campaign_id;
        if (cid) {
          await query(
            'INSERT INTO agent_sessions (agent_id, campaign_id, status) VALUES (?, ?, ?)',
            [agentId, cid, status]
          );
        }
      }
    }

    if (status === 'offline') {
      await query(
        'UPDATE agent_sessions SET logged_out_at = NOW() WHERE agent_id = ? AND logged_out_at IS NULL',
        [agentId]
      );
    }

    const socketService = getSocketService();
    if (socketService) {
      socketService.broadcastAgentStatus(agentId, status, { pause_code_id, campaign_id });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force logout an agent (admin only)
router.post('/:id/force-logout', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    if (!(await getOwnedUser(req, req.params.id))) return res.status(404).json({ error: 'Agent not found' });
    const agentId = parseInt(req.params.id);
    await query('UPDATE users SET status = "offline" WHERE id = ?', [agentId]);
    await query('UPDATE agent_sessions SET logged_out_at = NOW() WHERE agent_id = ? AND logged_out_at IS NULL', [agentId]);
    await query('UPDATE leads SET assigned_agent = NULL WHERE assigned_agent = ?', [agentId]);
    await query('UPDATE calls SET status = "abandoned", hung_up_at = NOW() WHERE agent_id = ? AND hung_up_at IS NULL', [agentId]);

    const socketService = getSocketService();
    if (socketService) {
      socketService.broadcastToAgent(agentId, 'force:logout', { reason: 'Forced logout by admin' });
      socketService.broadcastAgentStatus(agentId, 'offline', {});
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get campaigns assigned to an agent
router.get('/:id/campaigns', authenticate, async (req, res) => {
  try {
    if (!(await getOwnedUser(req, req.params.id))) return res.status(404).json({ error: 'Agent not found' });
    const assigned = await query('SELECT campaign_id FROM agent_campaigns WHERE agent_id = ?', [req.params.id]);
    res.json(assigned.map(r => r.campaign_id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Set campaigns assigned to an agent (replaces existing)
router.put('/:id/campaigns', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedUser(req, req.params.id))) return res.status(404).json({ error: 'Agent not found' });
    const { campaign_ids } = req.body; // array of IDs, or [] for all
    await query('DELETE FROM agent_campaigns WHERE agent_id = ?', [req.params.id]);
    if (Array.isArray(campaign_ids) && campaign_ids.length > 0) {
      for (const cid of campaign_ids) {
        // Only assign campaigns the caller actually owns.
        if (!(await getOwnedCampaign(req, cid))) continue;
        await query(
          'INSERT IGNORE INTO agent_campaigns (agent_id, campaign_id) VALUES (?, ?)',
          [req.params.id, cid]
        );
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Call agent to play audio confirmation ("you are the only person")
router.post('/:id/audio-check', authenticate, async (req, res) => {
  try {
    const agent = await getOwnedUser(req, req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (!agent.extension) return res.status(400).json({ error: 'No extension configured' });

    const { getAMI } = require('../services/amiClient');
    const ami = getAMI();
    if (!ami || !ami.isReady()) return res.status(503).json({ error: 'AMI not connected' });

    await ami.action({
      Action:   'Originate',
      Channel:  `PJSIP/${agent.extension}`,
      Context:  'agent-ready',
      Exten:    's',
      Priority: '1',
      CallerID: 'MynxDialer <System>',
      Timeout:  20000,
      Async:    'true',
    });
    res.json({ success: true, message: 'Audio check call sent to extension ' + agent.extension });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/login-campaign', authenticate, async (req, res) => {
  try {
    if (req.user.account_status === 'suspended') return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    const { campaign_id } = req.body;
    const agentId = req.params.id;

    // Agents log themselves in; admins/supervisors may act on their own account's agents.
    if (req.user.id !== parseInt(agentId) && !(await getOwnedUser(req, agentId)))
      return res.status(404).json({ error: 'Agent not found' });
    // The campaign must belong to the caller's account.
    if (!(await getOwnedCampaign(req, campaign_id)))
      return res.status(404).json({ error: 'Campaign not found' });

    await query(
      'UPDATE agent_sessions SET logged_out_at = NOW() WHERE agent_id = ? AND logged_out_at IS NULL',
      [agentId]
    );
    await query(
      'INSERT INTO agent_sessions (agent_id, campaign_id, status) VALUES (?, ?, ?)',
      [agentId, campaign_id, 'paused']
    );
    await query('UPDATE users SET status = ? WHERE id = ?', ['online', agentId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
