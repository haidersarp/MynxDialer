const express = require('express');
const { queryOne } = require('../db/connection');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/config', authenticate, async (req, res) => {
  try {
    const user = await queryOne(
      'SELECT id, username, extension, sip_password, full_name FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user.extension || !user.sip_password) {
      return res.status(400).json({ error: 'No SIP extension configured for this user' });
    }

    const asteriskHost = process.env.ASTERISK_HOST || '127.0.0.1';
    const wsPort     = process.env.ASTERISK_WS_PORT     || '8088';
    const sipPort    = process.env.ASTERISK_SIP_PORT    || '5060';
    // Use ws:// for local (Docker) testing, wss:// for production
    const wsProtocol = process.env.ASTERISK_WS_SECURE === 'true' ? 'wss' : 'ws';

    // The WS host can be overridden separately from the SIP host — useful on
    // Windows/Docker Desktop where the loopback WS proxy (com.docker.backend
    // on 127.0.0.1) can silently drop server-initiated pushes (e.g. incoming
    // INVITEs never reach the browser), while the IPv6 wslrelay path (::1)
    // works correctly.
    let wsHost = process.env.ASTERISK_WS_HOST || asteriskHost;
    if (wsHost.includes(':') && !wsHost.startsWith('[')) wsHost = `[${wsHost}]`;

    res.json({
      uri: `sip:${user.extension}@${asteriskHost}`,
      display_name: user.full_name || user.username,
      username: user.extension,
      password: user.sip_password,
      ws_servers: `${wsProtocol}://${wsHost}:${wsPort}/ws`,
      realm: asteriskHost,
      sip_host: asteriskHost,
      sip_port: sipPort,
      ice_servers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
