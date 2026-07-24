const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { stringify } = require('csv-stringify/sync');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { accountClause, accountId, getOwnedCampaign, getOwnedRow } = require('../middleware/tenant');

const router = express.Router();

// ── List all lead lists for a campaign ───────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { campaign_id } = req.query;
    const parts = [];
    const wp = [];
    if (campaign_id) { parts.push('ll.campaign_id = ?'); wp.push(parseInt(campaign_id)); }
    const sll = accountClause(req, 'll');
    if (sll.clause) { parts.push(sll.clause.replace(/^ AND /, '')); wp.push(...sll.params); }
    const where = parts.length ? 'WHERE ' + parts.join(' AND ') : '';

    const lists = await query(
      `SELECT ll.*,
         c.name as campaign_name,
         (SELECT COUNT(*) FROM leads l WHERE l.list_id = ll.id) as lead_count,
         (SELECT COUNT(*) FROM leads l WHERE l.list_id = ll.id AND l.status = 'new') as new_count,
         (SELECT COUNT(*) FROM leads l WHERE l.list_id = ll.id AND l.status NOT IN ('new','callback')) as dialed_count
       FROM lead_lists ll
       LEFT JOIN campaigns c ON c.id = ll.campaign_id
       ${where}
       ORDER BY ll.created_at DESC`,
      wp
    );
    res.json(lists);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Campaign-wide disposition breakdown (for Lead Recycle, list-independent) ──
// NOTE: must be declared BEFORE '/:id' or Express treats "campaign-stats" as an id.
router.get('/campaign-stats', authenticate, async (req, res) => {
  try {
    const { campaign_id } = req.query;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
    const cid = parseInt(campaign_id);
    if (!(await getOwnedCampaign(req, cid))) return res.status(404).json({ error: 'Campaign not found' });

    const totals = await queryOne(
      `SELECT COUNT(*) lead_count,
              SUM(status='new') new_count,
              SUM(status NOT IN ('new','callback')) dialed_count
       FROM leads WHERE campaign_id = ?`, [cid]
    );
    // Every distinct last_disposition (incl. auto ones like AMD/NODISPO), labelled
    // from the dispositions table where available.
    const breakdown = await query(
      `SELECT l.last_disposition as code,
              COALESCE(MAX(d.label), l.last_disposition) as label, MAX(d.color) as color,
              COUNT(*) as count
       FROM leads l LEFT JOIN dispositions d ON d.code = l.last_disposition
       WHERE l.campaign_id = ? AND l.last_disposition IS NOT NULL AND l.last_disposition <> ''
       GROUP BY l.last_disposition ORDER BY count DESC`, [cid]
    );
    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM leads WHERE campaign_id = ? GROUP BY status`, [cid]
    );
    res.json({ lead_count: totals.lead_count, breakdown, status_breakdown: statusBreakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get single list with full stats ─────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!(await getOwnedRow(req, 'lead_lists', req.params.id))) return res.status(404).json({ error: 'List not found' });
    const list = await queryOne(
      `SELECT ll.*, c.name as campaign_name,
         (SELECT COUNT(*) FROM leads l WHERE l.list_id = ll.id) as lead_count
       FROM lead_lists ll LEFT JOIN campaigns c ON c.id = ll.campaign_id WHERE ll.id = ?`,
      [req.params.id]
    );
    if (!list) return res.status(404).json({ error: 'List not found' });

    // Disposition breakdown
    const breakdown = await query(
      `SELECT d.label, d.color, d.code, COUNT(*) as count
       FROM leads l JOIN dispositions d ON d.code = l.last_disposition
       WHERE l.list_id = ? AND l.last_disposition IS NOT NULL
       GROUP BY d.code ORDER BY count DESC`,
      [req.params.id]
    );

    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM leads WHERE list_id = ${req.params.id} GROUP BY status`
    );

    res.json({ ...list, breakdown, status_breakdown: statusBreakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create a new list (used internally by import) ────────────────────────────
router.post('/', authenticate, requireRole('admin','supervisor'), async (req, res) => {
  try {
    const { campaign_id, name, original_filename, dial_order, dial_mode, column_mapping } = req.body;
    if (!(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });
    const result = await query(
      `INSERT INTO lead_lists (campaign_id, account_id, name, original_filename, dial_order, dial_mode, column_mapping)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [campaign_id, accountId(req), name, original_filename || null, dial_order || 'asc', dial_mode || 'simultaneous', column_mapping ? JSON.stringify(column_mapping) : null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update list settings ─────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin','supervisor'), async (req, res) => {
  try {
    if (!(await getOwnedRow(req, 'lead_lists', req.params.id))) return res.status(404).json({ error: 'List not found' });
    const { name, active, dial_order, dial_mode, seq_position } = req.body;
    const fields = [], vals = [];
    if (name        !== undefined) { fields.push('name = ?');         vals.push(name); }
    if (active      !== undefined) { fields.push('active = ?');       vals.push(active ? 1 : 0); }
    if (dial_order  !== undefined) { fields.push('dial_order = ?');   vals.push(dial_order); }
    if (dial_mode   !== undefined) { fields.push('dial_mode = ?');    vals.push(dial_mode); }
    if (seq_position!== undefined) { fields.push('seq_position = ?'); vals.push(seq_position); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await query(`UPDATE lead_lists SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete a list and all its leads ─────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const list = await getOwnedRow(req, 'lead_lists', req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });
    // Delete leads first, then the list
    await query('DELETE FROM leads WHERE list_id = ?', [req.params.id]);
    await query('DELETE FROM lead_lists WHERE id = ?', [req.params.id]);
    res.json({ success: true, deleted_leads: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Download list as CSV ─────────────────────────────────────────────────────
router.get('/:id/download', authenticate, async (req, res) => {
  try {
    const list  = await getOwnedRow(req, 'lead_lists', req.params.id);
    if (!list) return res.status(404).json({ error: 'Not found' });

    const leads = await query(
      'SELECT phone, first_name, last_name, email, address, city, state, zip, custom_fields, status, attempts, last_disposition FROM leads WHERE list_id = ? ORDER BY id',
      [req.params.id]
    );

    const rows = leads.map(l => {
      // custom_fields comes back as an object (mysql2 JSON) or string — handle both.
      const cf = (() => { try { return typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields || '{}') : (l.custom_fields || {}); } catch { return {}; } })();
      return { phone: l.phone, first_name: l.first_name, last_name: l.last_name, email: l.email, address: l.address, city: l.city, state: l.state, zip: l.zip, status: l.status, attempts: l.attempts, last_disposition: l.last_disposition, ...cf };
    });

    const csv = stringify(rows, { header: true });
    const filename = list.original_filename || `list_${list.id}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Recycle leads by disposition ─────────────────────────────────────────────
router.post('/:id/recycle', authenticate, requireRole('admin','supervisor'), async (req, res) => {
  try {
    const { dispositions } = req.body; // array of disposition codes to recycle
    if (!Array.isArray(dispositions) || !dispositions.length) {
      return res.status(400).json({ error: 'dispositions array required' });
    }

    const list = await getOwnedRow(req, 'lead_lists', req.params.id);
    if (!list) return res.status(404).json({ error: 'List not found' });

    const dispStr = dispositions.map(d => `'${d}'`).join(',');
    // Optional delay: how long before these recycled leads become dialable.
    // 0/missing = dial immediately (original behaviour). Clamped to ≤ 7 days.
    const delay = Math.max(0, Math.min(parseInt(req.body.delay_seconds) || 0, 604800));
    const notBefore = delay > 0 ? `DATE_ADD(NOW(), INTERVAL ${delay} SECOND)` : 'NULL';

    // Reset those leads to 'new' (set the "don't dial until" time if delayed)
    const result = await query(
      `UPDATE leads SET status = 'new', assigned_agent = NULL, attempts = 0, last_attempt = NULL, last_disposition = NULL, not_before = ${notBefore}
       WHERE list_id = ${req.params.id} AND last_disposition IN (${dispStr})`
    );

    // Remove from hopper so they get re-added fresh (and, if delayed, are not
    // dialed before their not_before time).
    await query(
      `DELETE FROM hopper WHERE campaign_id = ? AND lead_id IN (
        SELECT id FROM leads WHERE list_id = ${req.params.id} AND status = 'new' AND last_disposition IS NULL
      )`,
      [list.campaign_id]
    );

    res.json({ recycled: result.affectedRows, dispositions, delay_seconds: delay });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Count unlisted leads per campaign ────────────────────────────────────────
router.get('/unlisted/count', authenticate, requireRole('admin','supervisor'), async (req, res) => {
  try {
    const { campaign_id } = req.query;
    if (campaign_id && !(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });
    const where = campaign_id ? `AND campaign_id = ${parseInt(campaign_id)}` : '';
    const row = await queryOne(
      `SELECT COUNT(*) as c FROM leads WHERE list_id IS NULL ${where}`
    );
    res.json({ count: parseInt(row.c) || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create default list for unlisted leads ────────────────────────────────────
router.post('/unlisted/assign', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { campaign_id } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
    if (!(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });

    const count = await queryOne('SELECT COUNT(*) as c FROM leads WHERE list_id IS NULL AND campaign_id = ?', [campaign_id]);
    if (!count.c) return res.json({ success: true, message: 'No unlisted leads' });

    const result = await query(
      "INSERT INTO lead_lists (campaign_id, account_id, name, original_filename, dial_order) VALUES (?, ?, 'Default List', 'pre-existing leads', 'asc')",
      [campaign_id, accountId(req)]
    );
    const listId = result.insertId;
    await query('UPDATE leads SET list_id = ? WHERE list_id IS NULL AND campaign_id = ?', [listId, campaign_id]);
    await query('UPDATE lead_lists SET imported_count = ?, total_rows = ? WHERE id = ?', [count.c, count.c, listId]);
    res.json({ success: true, list_id: listId, assigned: count.c });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Recycle by disposition across a whole campaign ───────────────────────────
router.post('/recycle-campaign', authenticate, requireRole('admin','supervisor'), async (req, res) => {
  try {
    const { campaign_id, dispositions } = req.body;
    if (!campaign_id || !Array.isArray(dispositions) || !dispositions.length) {
      return res.status(400).json({ error: 'campaign_id and dispositions[] required' });
    }
    const cid = parseInt(campaign_id);
    if (!(await getOwnedCampaign(req, cid))) return res.status(404).json({ error: 'Campaign not found' });
    const dispStr = dispositions.map(d => `'${String(d).replace(/'/g, "''")}'`).join(',');
    // Optional delay before recycled leads become dialable (0 = immediate).
    const delay = Math.max(0, Math.min(parseInt(req.body.delay_seconds) || 0, 604800));
    const notBefore = delay > 0 ? `DATE_ADD(NOW(), INTERVAL ${delay} SECOND)` : 'NULL';

    // Reset matching leads to 'new' so the hopper redials them — no data lost
    // (name/phone/custom fields stay; only status/attempts/last_disposition reset).
    // not_before holds them out of the hopper until the chosen delay elapses.
    const result = await query(
      `UPDATE leads SET status='new', assigned_agent=NULL, attempts=0, last_attempt=NULL, last_disposition=NULL, not_before=${notBefore}
       WHERE campaign_id = ? AND last_disposition IN (${dispStr})`, [cid]
    );

    // If delayed, pull any of these leads that are already sitting in the hopper
    // so they don't get dialed before their time.
    if (delay > 0) {
      await query(
        `DELETE FROM hopper WHERE campaign_id = ? AND lead_id IN (
          SELECT id FROM leads WHERE campaign_id = ? AND not_before > NOW()
        )`, [cid, cid]
      );
    }

    res.json({ recycled: result.affectedRows, dispositions, delay_seconds: delay });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;