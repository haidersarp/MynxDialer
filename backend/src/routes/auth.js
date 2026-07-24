const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../db/connection');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await queryOne(
      'SELECT * FROM users WHERE username = ? AND active = 1',
      [username]
    );
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
    const _acc = user.account_id ? await queryOne('SELECT status, suspend_reason, name FROM accounts WHERE id = ?', [user.account_id]) : null;

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'changeme',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        extension: user.extension,
        account_status: _acc ? _acc.status : 'active',
        suspend_reason: _acc ? _acc.suspend_reason : null,
        account_name: _acc ? _acc.name : null
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await queryOne('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Password change failed' });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  try {
    await query('UPDATE users SET status = ? WHERE id = ?', ['offline', req.user.id]);
    await query(
      'UPDATE agent_sessions SET logged_out_at = NOW() WHERE agent_id = ? AND logged_out_at IS NULL',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
