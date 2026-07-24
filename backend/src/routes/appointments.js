const express = require('express');
const fs = require('fs');
const path = require('path');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { campaignClause, getOwnedCall } = require('../middleware/tenant');

const router = express.Router();

// List all appointments (calls with is_appointment disposition)
router.get('/', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { date_from, date_to, agent_id, campaign_id, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = ['(d.is_appointment = 1 OR d.is_sale = 1)'];
    const params = [];

    if (date_from) { where.push('DATE(c.called_at) >= ?'); params.push(date_from); }
    if (date_to)   { where.push('DATE(c.called_at) <= ?'); params.push(date_to); }
    if (agent_id)  { where.push('c.agent_id = ?'); params.push(agent_id); }
    if (campaign_id) { where.push('c.campaign_id = ?'); params.push(campaign_id); }
    const scList = campaignClause(req, 'c');
    if (scList.clause) { where.push(scList.clause.replace(/^ AND /, '')); params.push(...scList.params); }
    if (search) {
      where.push('(l.phone LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ? OR u.full_name LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const countRow = await queryOne(
      `SELECT COUNT(*) as total FROM calls c
       JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN users u ON u.id = c.agent_id
       WHERE ${where.join(' AND ')}`,
      params
    );

    const appointments = await query(
      `SELECT
         c.id, c.called_at, c.answered_at, c.hung_up_at, c.duration,
         c.recording_file, c.notes, c.caller_id, c.channel, c.appointment_status, c.appointment_note,
         d.label as disposition_label, d.color as disposition_color,
         u.id as agent_id, u.full_name as agent_name, u.extension as agent_extension,
         l.id as lead_id, l.phone, l.first_name, l.last_name, l.email,
         l.address, l.city, l.state, l.zip, l.custom_fields, l.attempts,
         ca.id as campaign_id, ca.name as campaign_name
       FROM calls c
       JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.called_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ appointments, total: countRow.total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent's OWN booked leads (calls they dispositioned as Sale/Appointment), with
// the admin's review status + comment. Scoped to the logged-in agent. Period
// filter: today (default) | yesterday | week | month. MUST be declared before
// '/:id' so Express doesn't treat "mine" as an :id.
router.get('/mine', authenticate, async (req, res) => {
  try {
    const period = ['today', 'yesterday', 'week', 'month'].includes(req.query.period) ? req.query.period : 'today';
    let dateClause;
    if (period === 'today')          dateClause = 'DATE(c.called_at) = CURDATE()';
    else if (period === 'yesterday') dateClause = 'DATE(c.called_at) = CURDATE() - INTERVAL 1 DAY';
    else if (period === 'week')      dateClause = 'YEARWEEK(c.called_at, 1) = YEARWEEK(CURDATE(), 1)';
    else                             dateClause = "c.called_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')";

    const rows = await query(
      `SELECT c.id, c.called_at, c.duration, c.appointment_status, c.appointment_note,
              c.recording_file, c.notes,
              d.label AS disposition_label, d.color AS disposition_color,
              l.first_name, l.last_name, l.phone, ca.name AS campaign_name
       FROM calls c
       JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.agent_id = ? AND (d.is_sale = 1 OR d.is_appointment = 1) AND ${dateClause}
       ORDER BY c.called_at DESC
       LIMIT 300`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single appointment detail
router.get('/:id', authenticate, async (req, res) => {
  try {
    const owned = await getOwnedCall(req, req.params.id);
    if (!owned) return res.status(404).json({ error: 'Appointment not found' });
    const appt = await queryOne(
      `SELECT c.*, d.label as disposition_label, d.color as disposition_color,
       u.full_name as agent_name, u.extension as agent_extension,
       l.phone, l.first_name, l.last_name, l.email, l.address, l.city, l.state, l.zip, l.custom_fields,
       ca.name as campaign_name
       FROM calls c
       JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       WHERE c.id = ? AND (d.is_appointment = 1 OR d.is_sale = 1)`,
      [req.params.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    res.json(appt);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats — accepted / cancelled (admin follow-up) + made today + this calendar week
router.get('/stats/summary', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    // Start of the current calendar week (Monday). Resets when a new week starts.
    const dow = now.getUTCDay();               // 0=Sun..6=Sat
    const back = (dow === 0 ? 6 : dow - 1);    // days since Monday
    const monday = new Date(now); monday.setUTCDate(now.getUTCDate() - back);
    const weekStart = monday.toISOString().split('T')[0];

    const scStats = campaignClause(req, 'c');
    const base = 'FROM calls c JOIN dispositions d ON d.id = c.disposition_id WHERE (d.is_appointment = 1 OR d.is_sale = 1)' + scStats.clause;
    // Accepted/Cancelled are scoped to THIS week so they reset every Monday.
    const [accepted, cancelled, madeToday, weekCount] = await Promise.all([
      queryOne(`SELECT COUNT(*) as c ${base} AND c.appointment_status = 'accepted' AND DATE(c.called_at) >= ?`, [...scStats.params, weekStart]),
      queryOne(`SELECT COUNT(*) as c ${base} AND c.appointment_status = 'cancelled' AND DATE(c.called_at) >= ?`, [...scStats.params, weekStart]),
      queryOne(`SELECT COUNT(*) as c ${base} AND DATE(c.called_at) = ?`, [...scStats.params, today]),
      queryOne(`SELECT COUNT(*) as c ${base} AND DATE(c.called_at) >= ?`, [...scStats.params, weekStart]),
    ]);

    res.json({
      accepted:   accepted.c,
      cancelled:  cancelled.c,
      made_today: madeToday.c,
      this_week:  weekCount.c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin marks a sale/appointment accepted or cancelled (after the follow-up call).
// An optional note is appended to the call's notes so it shows on the lead sheet.
router.post('/:id/status', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const ownedCall = await getOwnedCall(req, req.params.id);
    if (!ownedCall) return res.status(404).json({ error: 'Appointment not found' });
    const { status, note } = req.body;
    if (!['pending', 'accepted', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status (pending|accepted|cancelled)' });
    }
    await query('UPDATE calls SET appointment_status = ? WHERE id = ?', [status, req.params.id]);

    // Store the admin's comment in a dedicated column so the AGENT sees it
    // cleanly in their Booked Leads panel (alongside the status). Empty clears it.
    await query('UPDATE calls SET appointment_note = ? WHERE id = ?', [note && String(note).trim() ? String(note).trim() : null, req.params.id]);

    if (note && String(note).trim()) {
      const tag = status === 'accepted' ? '✓ Accepted' : status === 'cancelled' ? '✗ Cancelled' : 'Updated';
      const who = req.user.full_name || req.user.username || 'Admin';
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const line = `[${tag} by ${who} · ${stamp}] ${String(note).trim()}`;
      // CONCAT_WS skips NULL, so this appends cleanly even when notes was empty.
      await query("UPDATE calls SET notes = TRIM(CONCAT_WS('\n', NULLIF(notes,''), ?)) WHERE id = ?", [line, req.params.id]);
    }
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Permanently delete an appointment/sale record (the call row). Admin only.
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const ownedDel = await getOwnedCall(req, req.params.id);
    if (!ownedDel) return res.status(404).json({ error: 'Appointment not found' });
    await query('DELETE FROM calls WHERE id = ?', [req.params.id]);
    res.json({ success: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;