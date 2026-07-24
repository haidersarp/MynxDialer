const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');

// Every /api/hq route is SUPER-ADMIN only.
router.use(authenticate, requireRole('super_admin'));

// ── List all accounts (tenants) with headline counts ─────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const rows = await query(`
      SELECT a.id, a.name, a.status, a.max_agents, a.max_campaigns,
             a.ext_range_start, a.ext_range_end, a.suspend_reason, a.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.account_id = a.id AND u.role IN ('admin','supervisor')) AS staff_count,
        (SELECT COUNT(*) FROM users u WHERE u.account_id = a.id AND u.role = 'agent')                 AS agent_count,
        (SELECT COUNT(*) FROM campaigns c WHERE c.account_id = a.id)                                  AS campaign_count
      FROM accounts a
      ORDER BY a.id ASC`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create a new account + its first admin, auto-allocating an extension block ─
router.post('/accounts', async (req, res) => {
  try {
    const { name, admin_username, admin_password, admin_full_name, max_agents, max_campaigns } = req.body;
    if (!name || !admin_username || !admin_password)
      return res.status(400).json({ error: 'Account name, admin username and admin password are all required' });
    if (String(admin_password).length < 6)
      return res.status(400).json({ error: 'Admin password must be at least 6 characters' });

    // Login is by username, so it must be globally unique.
    const dupe = await queryOne('SELECT id FROM users WHERE username = ?', [admin_username]);
    if (dupe) return res.status(409).json({ error: `Username "${admin_username}" is already taken` });

    // Allocate the next 100-wide extension block after the highest existing one.
    const row = await queryOne('SELECT COALESCE(MAX(ext_range_end), 1000) AS m FROM accounts');
    const extStart = Number(row.m) + 1;
    const extEnd   = extStart + 99;

    const acc = await query(
      `INSERT INTO accounts (name, status, max_agents, max_campaigns, ext_range_start, ext_range_end)
       VALUES (?, 'active', ?, ?, ?, ?)`,
      [name, max_agents || null, max_campaigns || null, extStart, extEnd]
    );
    const accountId = acc.insertId;

    const hash = await bcrypt.hash(String(admin_password), 12);
    const adminUser = await query(
      `INSERT INTO users (username, password, email, full_name, role, extension, sip_password, account_id, active)
       VALUES (?, ?, NULL, ?, 'admin', NULL, NULL, ?, 1)`,
      [admin_username, hash, admin_full_name || (name + ' Admin'), accountId]
    );

    res.status(201).json({
      account: { id: accountId, name, status: 'active', ext_range_start: extStart, ext_range_end: extEnd },
      admin:   { id: adminUser.insertId, username: admin_username, role: 'admin' }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update an account: suspend/activate, rename, change limits ────────────────
router.patch('/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, name, max_agents, max_campaigns, suspend_reason } = req.body;
    if (id === 1 && status === 'suspended')
      return res.status(400).json({ error: 'The main account cannot be suspended' });

    const sets = [], vals = [];
    if (status) { sets.push('suspend_reason = ?'); vals.push(status === 'suspended' ? (suspend_reason || 'technical') : null); }
    if (status)                      { sets.push('status = ?');        vals.push(status); }
    if (name)                        { sets.push('name = ?');          vals.push(name); }
    if (max_agents !== undefined)    { sets.push('max_agents = ?');    vals.push(max_agents || null); }
    if (max_campaigns !== undefined) { sets.push('max_campaigns = ?'); vals.push(max_campaigns || null); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(id);
    await query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
