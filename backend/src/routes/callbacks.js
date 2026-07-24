const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate } = require('../middleware/auth');
const { campaignClause } = require('../middleware/tenant');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status = 'pending', page = 1, limit = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const isAdmin = ['admin', 'supervisor'].includes(req.user.role);

    // Parameterized filter (fixes SQL injection via status/agent_id).
    const whereParts = ['cb.status = ?'];
    const whereParams = [status];
    if (!isAdmin) { whereParts.push('(cb.agent_id = ? OR cb.agent_id IS NULL)'); whereParams.push(req.user.id); }
    const scCb = campaignClause(req, 'cb');
    if (scCb.clause) { whereParts.push(scCb.clause.replace(/^ AND /, '')); whereParams.push(...scCb.params); }
    const agentWhere = whereParts.join(' AND ');

    const countRow = await queryOne(
      `SELECT COUNT(*) as c FROM callbacks cb WHERE ${agentWhere}`,
      whereParams
    );

    const callbacks = await query(
      `SELECT
         cb.id, cb.scheduled_at, cb.notes, cb.status, cb.created_at,
         l.id as lead_id, l.phone, l.first_name, l.last_name, l.email,
         l.address, l.city, l.state, l.zip, l.custom_fields, l.attempts,
         l.last_disposition,
         u.full_name as agent_name, u.extension as agent_extension, u.id as agent_id,
         ca.name as campaign_name, ca.id as campaign_id,
         (SELECT COUNT(*) FROM calls c2 WHERE c2.lead_id = l.id) as call_count
       FROM callbacks cb
       JOIN leads l ON l.id = cb.lead_id
       LEFT JOIN users u ON u.id = cb.agent_id
       LEFT JOIN campaigns ca ON ca.id = cb.campaign_id
       WHERE ${agentWhere}
       ORDER BY cb.scheduled_at ASC
       LIMIT ? OFFSET ?`,
      [...whereParams, parseInt(limit), offset]
    );

    res.json({ callbacks, total: parseInt(countRow.c) || 0 });
  } catch (err) {
    console.error('[Callbacks] GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['completed','missed','pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    // Verify the callback belongs to the caller's account (super_admin bypasses).
    const { tenant } = require('../middleware/tenant');
    const t = tenant(req);
    const owned = await queryOne(
      'SELECT cb.id, c.account_id FROM callbacks cb JOIN campaigns c ON c.id = cb.campaign_id WHERE cb.id = ?',
      [req.params.id]
    );
    if (!owned || (!t.superAdmin && owned.account_id != t.accountId)) return res.status(404).json({ error: 'Callback not found' });
    await query('UPDATE callbacks SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/count', authenticate, async (req, res) => {
  try {
    const isAdmin = ['admin','supervisor'].includes(req.user.role);
    const whereParts = ['status = ?'];
    const whereParams = ['pending'];
    if (!isAdmin) { whereParts.push('(agent_id = ? OR agent_id IS NULL)'); whereParams.push(req.user.id); }
    const scCb = campaignClause(req, '');
    if (scCb.clause) { whereParts.push(scCb.clause.replace(/^ AND /, '')); whereParams.push(...scCb.params); }
    const where = whereParts.join(' AND ');
    const row = await queryOne(
      `SELECT COUNT(*) as total, SUM(CASE WHEN scheduled_at <= NOW() THEN 1 ELSE 0 END) as overdue FROM callbacks WHERE ${where}`,
      whereParams
    );
    res.json({ total: parseInt(row.total)||0, overdue: parseInt(row.overdue)||0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;