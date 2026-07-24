const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { accountClause, accountId, getOwnedCampaign } = require('../middleware/tenant');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const conds = [];
    const params = [];

    // Tenant scope (super_admin sees all)
    const ac = accountClause(req, 'c');
    if (ac.clause) { conds.push(ac.clause.replace(/^ AND /, '')); params.push(...ac.params); }

    // For agents: only campaigns they're assigned to (if any assignments exist)
    if (req.user.role === 'agent') {
      const assigned = await query('SELECT campaign_id FROM agent_campaigns WHERE agent_id = ?', [req.user.id]);
      if (assigned.length > 0) {
        conds.push(`c.id IN (${assigned.map(() => '?').join(',')})`);
        params.push(...assigned.map(r => r.campaign_id));
      }
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const campaigns = await query(
      `SELECT c.*, cg.name as cid_group_name, st.name as sip_trunk_name,
       (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id) as total_leads,
       (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id AND l.status = 'new') as new_leads,
       (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id AND l.status = 'completed') as completed_leads
       FROM campaigns c
       LEFT JOIN caller_id_groups cg ON cg.id = c.cid_group_id
       LEFT JOIN sip_trunks st ON st.id = c.sip_trunk_id
       ${where}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const campaign = await getOwnedCampaign(req, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const {
      name, description, dial_method, dial_ratio, max_attempts, retry_delay,
      cid_group_id, sip_trunk_id, queue_name, script, timezone, start_time, end_time,
      amd_enabled, record_calls, hopper_level, hopper_threshold
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Campaign name required' });

    const result = await query(
      `INSERT INTO campaigns (name, description, dial_method, dial_ratio, max_attempts, retry_delay,
       cid_group_id, sip_trunk_id, queue_name, script, timezone, start_time, end_time, amd_enabled, record_calls, hopper_level, hopper_threshold, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name, description || null, dial_method || 'predictive',
        dial_ratio || 1.0, max_attempts || 3, retry_delay || 3600,
        cid_group_id || null, sip_trunk_id || null, queue_name || 'default',
        script || null, timezone || 'America/New_York',
        start_time || '08:00:00', end_time || '21:00:00',
        amd_enabled ? 1 : 0, record_calls ? 1 : 0,
        Math.min(10000, parseInt(hopper_level) || 1000),
        hopper_threshold != null ? Math.min(10000, parseInt(hopper_threshold) || 0) : 100,
        accountId(req)
      ]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    const {
      name, description, dial_method, dial_ratio, max_attempts, retry_delay,
      cid_group_id, sip_trunk_id, queue_name, script, timezone, start_time, end_time,
      amd_enabled, record_calls, hopper_level, hopper_threshold
    } = req.body;

    await query(
      `UPDATE campaigns SET name=?, description=?, dial_method=?, dial_ratio=?, max_attempts=?,
       retry_delay=?, cid_group_id=?, sip_trunk_id=?, queue_name=?, script=?, timezone=?, start_time=?,
       end_time=?, amd_enabled=?, record_calls=?, hopper_level=?, hopper_threshold=? WHERE id=?`,
      [
        name, description || null, dial_method, dial_ratio, max_attempts, retry_delay,
        cid_group_id || null, sip_trunk_id || null, queue_name, script || null, timezone,
        start_time, end_time, amd_enabled ? 1 : 0, record_calls ? 1 : 0,
        Math.min(10000, parseInt(hopper_level) || 1000),
        hopper_threshold != null ? Math.min(10000, parseInt(hopper_threshold) || 0) : 100,
        req.params.id
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    await query('DELETE FROM campaigns WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/status', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    const { status } = req.body;
    if (!['active', 'inactive', 'paused'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await query('UPDATE campaigns SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hopper status for a campaign
router.get('/:id/hopper', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const campaign = await getOwnedCampaign(req, req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { getHopperStats } = require('../services/hopperService');
    const stats = await getHopperStats(req.params.id);
    res.json({ ...stats, hopper_level: campaign.hopper_level || 100 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Refill or flush hopper for a campaign
router.post('/:id/hopper/refill', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    const { flushHopper, getHopperStats } = require('../services/hopperService');
    await flushHopper(req.params.id);
    res.json(await getHopperStats(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/hopper', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    await query("DELETE FROM hopper WHERE campaign_id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/dispositions', authenticate, async (req, res) => {
  try {
    if (!(await getOwnedCampaign(req, req.params.id))) return res.status(404).json({ error: 'Campaign not found' });
    const disps = await query(
      `SELECT * FROM dispositions WHERE (campaign_id = ? OR campaign_id IS NULL) AND active = 1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json(disps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
