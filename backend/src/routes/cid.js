const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { accountClause, accountId, getOwnedRow, getOwnedCampaign } = require('../middleware/tenant');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const sg = accountClause(req, 'g');
    const groups = await query(
      `SELECT g.*, COUNT(c.id) as number_count,
              st.name AS trunk_name, cp.name AS campaign_name
       FROM caller_id_groups g
       LEFT JOIN caller_ids c ON c.group_id = g.id AND c.active = 1
       LEFT JOIN sip_trunks st ON st.id = g.sip_trunk_id
       LEFT JOIN campaigns cp ON cp.id = g.campaign_id
       ${sg.clause ? 'WHERE ' + sg.clause.replace(/^ AND /, '') : ''}
       GROUP BY g.id ORDER BY g.name`,
      sg.params
    );
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const group = await getOwnedRow(req, 'caller_id_groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const numbers = await query('SELECT * FROM caller_ids WHERE group_id = ? ORDER BY id', [req.params.id]);
    res.json({ ...group, numbers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, rotation_type, sip_trunk_id, campaign_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (campaign_id && !(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });
    const result = await query(
      'INSERT INTO caller_id_groups (name, rotation_type, sip_trunk_id, campaign_id, account_id) VALUES (?, ?, ?, ?, ?)',
      [name, rotation_type || 'round_robin', sip_trunk_id || null, campaign_id || null, accountId(req)]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, rotation_type, sip_trunk_id, campaign_id } = req.body;
    if (!(await getOwnedRow(req, 'caller_id_groups', req.params.id))) return res.status(404).json({ error: 'Group not found' });
    if (campaign_id && !(await getOwnedCampaign(req, campaign_id))) return res.status(404).json({ error: 'Campaign not found' });
    await query(
      'UPDATE caller_id_groups SET name = ?, rotation_type = ?, sip_trunk_id = ?, campaign_id = ? WHERE id = ?',
      [name, rotation_type, sip_trunk_id || null, campaign_id || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedRow(req, 'caller_id_groups', req.params.id))) return res.status(404).json({ error: 'Group not found' });
    await query('DELETE FROM caller_ids WHERE group_id = ?', [req.params.id]);
    await query('DELETE FROM caller_id_groups WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/numbers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { number, description } = req.body;
    if (!number) return res.status(400).json({ error: 'Number required' });
    if (!(await getOwnedRow(req, 'caller_id_groups', req.params.id))) return res.status(404).json({ error: 'Group not found' });
    const result = await query(
      'INSERT INTO caller_ids (group_id, number, description) VALUES (?, ?, ?)',
      [req.params.id, number, description || null]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:groupId/numbers/:numberId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await getOwnedRow(req, 'caller_id_groups', req.params.groupId))) return res.status(404).json({ error: 'Group not found' });
    await query('DELETE FROM caller_ids WHERE id = ? AND group_id = ?',
      [req.params.numberId, req.params.groupId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/next-number', authenticate, async (req, res) => {
  try {
    const group = await getOwnedRow(req, 'caller_id_groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    const numbers = await query('SELECT * FROM caller_ids WHERE group_id = ? AND active = 1 ORDER BY id', [req.params.id]);
    if (!numbers.length) return res.status(404).json({ error: 'No active numbers in group' });

    let selected;
    if (group.rotation_type === 'random') {
      selected = numbers[Math.floor(Math.random() * numbers.length)];
    } else {
      const idx = group.last_used_index % numbers.length;
      selected = numbers[idx];
      await query('UPDATE caller_id_groups SET last_used_index = ? WHERE id = ?', [idx + 1, group.id]);
    }

    res.json({ number: selected.number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
