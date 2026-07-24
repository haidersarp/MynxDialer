// Internal team chat — Announce (admin broadcast), per-campaign group chats, and
// 1:1 DMs. Text + attachments (images/docs) + admin "priority" popups. Live
// delivery is in the chat:send socket handler; this route serves history, the
// contact list, the campaign list, and file uploads. Nothing here touches calls.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { query } = require('../db/connection');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// ── File uploads: images (inline) + docs (PDF/Word/Excel/text) as links, ≤10MB ──
const UPLOAD_DIR = path.join(__dirname, '../../uploads/chat');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
const ALLOWED = {
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'application/pdf': 'file',
  'application/msword': 'file',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file',
  'application/vnd.ms-excel': 'file',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'file',
  'text/plain': 'file', 'text/csv': 'file'
};
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '').slice(0, 12);
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!ALLOWED[file.mimetype])
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File rejected — allowed: images, PDF, Word, Excel, text (max 10MB)' });
  res.json({
    url: `/uploads/chat/${req.file.filename}`,
    name: req.file.originalname || req.file.filename,
    type: ALLOWED[req.file.mimetype] || 'file'
  });
});

// Who can I DM? Everyone active except myself, with live-online flag.
router.get('/users', async (req, res) => {
  try {
    const isSuper = req.user.role === 'super_admin';
    const params = [req.user.id];
    let acctSql = '';
    if (!isSuper) { acctSql = ' AND account_id = ?'; params.push(req.user.account_id); }
    const rows = await query(
      "SELECT id, username, full_name, role FROM users WHERE active = 1 AND id <> ?" + acctSql + " ORDER BY role, COALESCE(full_name, username)",
      params
    );
    let online = () => false;
    try {
      const svc = require('../services/socketService').getSocketService();
      if (svc) online = (id) => svc.isAgentConnected(id);
    } catch (_) {}
    res.json(rows.map(u => ({ id: u.id, name: u.full_name || u.username, role: u.role, online: !!online(u.id) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Campaigns for the admin's "which campaign chat" dropdown.
router.get('/campaigns', async (req, res) => {
  try {
    if (req.user.role === 'super_admin') return res.json(await query('SELECT id, name FROM campaigns ORDER BY name'));
    return res.json(await query('SELECT id, name FROM campaigns WHERE account_id = ? ORDER BY name', [req.user.account_id]));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// History. ?channel=broadcast|campaign|dm  (campaign needs campaign_id, dm needs with)
router.get('/history', async (req, res) => {
  try {
    const channel = ['broadcast', 'campaign', 'dm', 'team'].includes(req.query.channel) ? req.query.channel : 'broadcast';
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    const cols = `m.id, m.channel, m.sender_id, m.recipient_id, m.campaign_id, m.body, m.priority,
                  m.attachment_url, m.attachment_name, m.attachment_type, m.created_at,
                  COALESCE(u.full_name, u.username) AS sender_name, u.role AS sender_role`;
    let rows;
    if (channel === 'dm') {
      const withId = parseInt(req.query.with);
      if (!withId) return res.json([]);
      rows = await query(
        `SELECT ${cols} FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel = 'dm'
           AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))
         ORDER BY m.id DESC LIMIT ?`,
        [req.user.id, withId, withId, req.user.id, limit]
      );
    } else if (channel === 'campaign') {
      const cid = parseInt(req.query.campaign_id);
      if (!cid) return res.json([]);
      rows = await query(
        `SELECT ${cols} FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel = 'campaign' AND m.campaign_id = ? ORDER BY m.id DESC LIMIT ?`,
        [cid, limit]
      );
    } else {
      const isSuper = req.user.role === 'super_admin';
      rows = await query(
        `SELECT ${cols} FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.channel = ?` + (isSuper ? '' : ' AND m.account_id = ?') + ` ORDER BY m.id DESC LIMIT ?`,
        isSuper ? [channel, limit] : [channel, req.user.account_id, limit]
      );
    }
    res.json(rows.reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;