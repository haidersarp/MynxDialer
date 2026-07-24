const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { query, queryOne, transaction } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { importCSV, parseHeaders, SYSTEM_FIELDS } = require('../services/csvImport');
const { campaignClause, accountId, getOwnedCampaign, getOwnedLead } = require('../middleware/tenant');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', authenticate, async (req, res) => {
  try {
    const { campaign_id, status, search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = [];
    const params = [];

    if (campaign_id) { where.push('l.campaign_id = ?'); params.push(campaign_id); }
    if (status) { where.push('l.status = ?'); params.push(status); }
    if (search) {
      where.push('(l.phone LIKE ? OR l.first_name LIKE ? OR l.last_name LIKE ? OR l.email LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const cc = campaignClause(req, 'l');
    if (cc.clause) { where.push(cc.clause.replace(/^ AND /, '')); params.push(...cc.params); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const countRow = await queryOne(
      `SELECT COUNT(*) as total FROM leads l ${whereStr}`, params
    );

    const leads = await query(
      `SELECT l.*, u.full_name as agent_name,
       CASE WHEN d.phone IS NOT NULL THEN 1 ELSE 0 END as is_dnc
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_agent
       LEFT JOIN dnc_list d ON d.phone = l.phone AND d.account_id = (SELECT account_id FROM campaigns WHERE id = l.campaign_id)
       ${whereStr}
       ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({ leads, total: countRow.total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/next', authenticate, async (req, res) => {
  try {
    const { campaign_id } = req.query;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });
    if (!(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'No leads available' });

    const now = new Date();
    const lead = await queryOne(
      `SELECT l.* FROM leads l
       WHERE l.campaign_id = ?
         AND l.status IN ('new', 'called')
         AND l.phone NOT IN (SELECT phone FROM dnc_list WHERE account_id = (SELECT account_id FROM campaigns WHERE id = ?))
         AND (l.callback_at IS NULL OR l.callback_at <= ?)
         AND l.assigned_agent IS NULL
       ORDER BY l.status ASC, l.attempts ASC, l.created_at ASC
       LIMIT 1`,
      [campaign_id, campaign_id, now]
    );

    if (!lead) return res.status(404).json({ error: 'No leads available' });

    await query('UPDATE leads SET assigned_agent = ? WHERE id = ?', [req.user.id, lead.id]);
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const lead = await getOwnedLead(req, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    delete lead._acct;

    const callHistory = await query(
      `SELECT c.*, u.full_name as agent_name, d.label as disposition_label
       FROM calls c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       WHERE c.lead_id = ?
       ORDER BY c.called_at DESC LIMIT 20`,
      [lead.id]
    );

    res.json({ ...lead, call_history: callHistory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { campaign_id, phone, first_name, last_name, email, address, city, state, zip, custom_fields } = req.body;
    if (!campaign_id || !phone) return res.status(400).json({ error: 'campaign_id and phone required' });
    if (!(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });

    const dnc = await queryOne('SELECT id FROM dnc_list WHERE phone = ? AND account_id = (SELECT account_id FROM campaigns WHERE id = ?)', [phone, campaign_id]);
    if (dnc) return res.status(409).json({ error: 'Phone number is on DNC list' });

    const result = await query(
      'INSERT INTO leads (campaign_id, phone, first_name, last_name, email, address, city, state, zip, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [campaign_id, phone, first_name || null, last_name || null, email || null, address || null, city || null, state || null, zip || null, custom_fields ? JSON.stringify(custom_fields) : null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 1: Parse headers for the mapping wizard
router.post('/parse-headers', authenticate, requireRole('admin','supervisor'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const result = await parseHeaders(req.file.path);
    // Keep the file for the actual import — return the path
    res.json({ ...result, temp_path: req.file.path, system_fields: SYSTEM_FIELDS });
  } catch (err) {
    console.error('[parse-headers] failed:', err.message);
    try { fs.unlinkSync(req.file?.path); } catch (_) {}
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Actual import (with optional column mapping + list creation)
router.post('/import', authenticate, requireRole('admin', 'supervisor'), upload.single('file'), async (req, res) => {
  try {
    const { campaign_id, temp_path, column_mapping, list_name, dial_order, dial_mode, allow_duplicates } = req.body;
    if (!campaign_id) return res.status(400).json({ error: 'campaign_id required' });

    const filePath = req.file?.path || temp_path;
    if (!filePath) return res.status(400).json({ error: 'No file provided' });

    if (!(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });

    // Create the lead list record first
    const listResult = await query(
      `INSERT INTO lead_lists (campaign_id, name, original_filename, dial_order, dial_mode, column_mapping, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        campaign_id,
        list_name || `Import ${new Date().toLocaleDateString('en-GB')}`,
        req.file?.originalname || 'import.csv',
        dial_order || 'asc',
        dial_mode  || 'simultaneous',
        column_mapping ? (typeof column_mapping === 'string' ? column_mapping : JSON.stringify(column_mapping)) : null,
        accountId(req)
      ]
    );
    const listId = listResult.insertId;

    const mapping = column_mapping
      ? (typeof column_mapping === 'string' ? JSON.parse(column_mapping) : column_mapping)
      : null;

    const result = await importCSV(filePath, parseInt(campaign_id), listId, mapping, { allowDuplicates: allow_duplicates === 'true' || allow_duplicates === true });
    res.json({ ...result, list_id: listId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    if (!(await getOwnedLead(req, req.params.id))) return res.status(404).json({ error: 'Lead not found' });
    const { status, notes, custom_fields } = req.body;
    const fields = [];
    const vals = [];

    if (status) { fields.push('status = ?'); vals.push(status); }
    if (notes !== undefined) { fields.push('notes = ?'); vals.push(notes); }
    if (custom_fields) { fields.push('custom_fields = ?'); vals.push(JSON.stringify(custom_fields)); }

    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await query(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedLead(req, req.params.id))) return res.status(404).json({ error: 'Lead not found' });
    await query('DELETE FROM leads WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
