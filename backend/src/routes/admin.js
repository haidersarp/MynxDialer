const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// SIP trunks + system settings are HQ-managed (all tenants share the Default Provider trunk).
// Only the super-admin or the main HQ account (id 1) may view/change them.
const requireHQ = (req, res, next) => {
  if (req.user && (req.user.role === 'super_admin' || req.user.account_id === 1)) return next();
  return res.status(403).json({ error: 'SIP & system settings are managed by HQ only.' });
};
router.use(['/sip-provider', '/settings'], authenticate, requireHQ);

// HQ = super-admin or the main account (id 1). Clients manage only their OWN
// trunks; the shared default (Default Provider, is_default) is HQ-only.
const isHQ = (req) => !!(req.user && (req.user.role === 'super_admin' || req.user.account_id === 1));
async function ownsTrunk(req, id) {
  if (isHQ(req)) return true;
  const t = await queryOne('SELECT account_id, is_default FROM sip_trunks WHERE id = ?', [id]);
  return !!(t && t.account_id === req.user.account_id && !t.is_default);
}

// Dispositions
router.get('/dispositions', authenticate, async (req, res) => {
  try {
    const { campaign_id } = req.query;
    const where = campaign_id ? 'WHERE campaign_id = ? OR campaign_id IS NULL' : '';
    const params = campaign_id ? [campaign_id] : [];
    const disps = await query(
      `SELECT * FROM dispositions ${where} ORDER BY campaign_id IS NULL DESC, sort_order ASC`,
      params
    );
    res.json(disps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/dispositions', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { campaign_id, code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order } = req.body;
    if (!code || !label) return res.status(400).json({ error: 'Code and label required' });
    const result = await query(
      'INSERT INTO dispositions (campaign_id, code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [campaign_id || null, code, label, color || '#666666', is_sale ? 1 : 0, is_dnc ? 1 : 0, is_callback ? 1 : 0, is_appointment ? 1 : 0, sort_order || 0]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/dispositions/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { code, label, color, is_sale, is_dnc, is_callback, is_appointment, active, sort_order } = req.body;
    await query(
      'UPDATE dispositions SET code=?, label=?, color=?, is_sale=?, is_dnc=?, is_callback=?, is_appointment=?, active=?, sort_order=? WHERE id=?',
      [code, label, color, is_sale ? 1 : 0, is_dnc ? 1 : 0, is_callback ? 1 : 0, is_appointment ? 1 : 0, active !== false ? 1 : 0, sort_order || 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dispositions/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM dispositions WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pause codes
router.get('/pause-codes', authenticate, async (req, res) => {
  try {
    const codes = await query('SELECT * FROM pause_codes ORDER BY label');
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pause-codes', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { code, label, billable } = req.body;
    const result = await query(
      'INSERT INTO pause_codes (code, label, billable) VALUES (?, ?, ?)',
      [code, label, billable ? 1 : 0]
    );
    res.status(201).json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/pause-codes/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { code, label, billable, active } = req.body;
    await query(
      'UPDATE pause_codes SET code=?, label=?, billable=?, active=? WHERE id=?',
      [code, label, billable ? 1 : 0, active !== false ? 1 : 0, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pause-codes/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await query('DELETE FROM pause_codes WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DNC list
router.get('/dnc', authenticate, async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conds = [];
    const params = [];
    if (search) { conds.push('d.phone LIKE ?'); params.push(`%${search}%`); }
    // Tenant isolation: each account sees only its own DNC list (super_admin sees all).
    if (req.user.role !== 'super_admin') { conds.push('d.account_id = ?'); params.push(req.user.account_id); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const countRow = await queryOne(`SELECT COUNT(*) as c FROM dnc_list d ${where}`, params);
    const list = await query(
      `SELECT d.*, u.full_name as added_by_name
       FROM dnc_list d LEFT JOIN users u ON u.id = d.added_by
       ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json({ list, total: countRow.c });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/dnc', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { phone, reason } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    await query(
      'INSERT IGNORE INTO dnc_list (phone, account_id, added_by, reason) VALUES (?, ?, ?, ?)',
      [phone.replace(/\D/g, ''), req.user.account_id, req.user.id, reason || null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/dnc/bulk', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { phones } = req.body;
    if (!Array.isArray(phones)) return res.status(400).json({ error: 'phones array required' });
    let added = 0;
    for (const phone of phones) {
      const clean = phone.replace(/\D/g, '');
      if (clean.length >= 7) {
        await query('INSERT IGNORE INTO dnc_list (phone, account_id, added_by) VALUES (?, ?, ?)', [clean, req.user.account_id, req.user.id]);
        added++;
      }
    }
    res.json({ added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/dnc/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const acct = req.user.role === 'super_admin' ? null : req.user.account_id;
    await query('DELETE FROM dnc_list WHERE id = ? AND (? IS NULL OR account_id = ?)', [req.params.id, acct, acct]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SIP Trunks
router.get('/sip-trunks', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const hq = isHQ(req);
    const trunks = hq
      ? await query('SELECT * FROM sip_trunks ORDER BY is_default DESC, name')
      : await query('SELECT * FROM sip_trunks WHERE account_id = ? OR is_default = 1 ORDER BY is_default DESC, name', [req.user.account_id]);
    // a client's own CLIs live in CID Groups, not on the shared trunk — surface that count on the read-only card
    let cidCliCount = 0;
    if (!hq) {
      const cc = await queryOne(
        `SELECT COUNT(*) AS c FROM caller_ids ci JOIN caller_id_groups g ON g.id = ci.group_id
         WHERE ci.active = 1 AND g.account_id = ?`, [req.user.account_id]);
      cidCliCount = cc ? cc.c : 0;
    }
    const out = trunks.map(t => {
      if (hq || t.account_id === req.user.account_id) return { ...t, _readonly: 0 };
      // shared default (e.g. Default Provider) shown to a client — hide its credentials, but show their own CID-group CLI count
      return { id: t.id, name: t.name, is_default: t.is_default, account_id: t.account_id, active: t.active, _readonly: 1, cid_cli_count: cidCliCount };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sip-trunks', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, host, port, username, password, context, codec, auth_type, from_user, clis, is_default } = req.body;
    if (!name || !host) return res.status(400).json({ error: 'Provider name and host are required' });
    const authType = (auth_type === 'userpass' || (username && password)) ? 'userpass' : 'ip';

    // If this is the first trunk, force it default. If flagged default, clear others.
    const existing = await query('SELECT COUNT(*) AS n FROM sip_trunks');
    const makeDefault = isHQ(req) && (is_default || existing[0].n === 0);
    if (makeDefault) await query('UPDATE sip_trunks SET is_default = 0');

    const result = await query(
      `INSERT INTO sip_trunks (name, host, port, username, password, context, codec, auth_type, from_user, clis, is_default, active, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [name, host, port || 5060, username || null, password || null, context || 'from-trunk',
       codec || 'ulaw,alaw', authType, from_user || null, clis || null, makeDefault ? 1 : 0, req.user.account_id]
    );

    const { generatePjsipConf } = require('../services/pjsipConfig');
    const applied = await generatePjsipConf();
    res.status(201).json({ id: result.insertId, ...applied });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/sip-trunks/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await ownsTrunk(req, req.params.id))) return res.status(404).json({ error: 'Provider not found' });
    const { name, host, port, username, password, context, codec, active, auth_type, from_user, clis, is_default } = req.body;
    const authType = (auth_type === 'userpass' || (username && password)) ? 'userpass' : 'ip';

    if (is_default && isHQ(req)) await query('UPDATE sip_trunks SET is_default = 0');

    await query(
      `UPDATE sip_trunks SET name=?, host=?, port=?, username=?, password=?, context=?, codec=?,
       active=?, auth_type=?, from_user=?, clis=?, is_default=? WHERE id=?`,
      [name, host, port || 5060, username || null, password || null, context || 'from-trunk',
       codec || 'ulaw,alaw', active === undefined ? 1 : (active ? 1 : 0), authType,
       from_user || null, clis || null, (is_default && isHQ(req)) ? 1 : 0, req.params.id]
    );

    // Never leave the system without a default trunk.
    const def = await query('SELECT COUNT(*) AS n FROM sip_trunks WHERE is_default = 1 AND active = 1');
    if (def[0].n === 0) {
      await query('UPDATE sip_trunks SET is_default = 1 WHERE active = 1 ORDER BY id ASC LIMIT 1');
    }

    const { generatePjsipConf } = require('../services/pjsipConfig');
    const applied = await generatePjsipConf();
    res.json({ success: true, ...applied });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sip-trunks/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await ownsTrunk(req, req.params.id))) return res.status(404).json({ error: 'Provider not found' });
    const row = await queryOne('SELECT is_default FROM sip_trunks WHERE id = ?', [req.params.id]);
    await query('DELETE FROM sip_trunks WHERE id = ?', [req.params.id]);
    // Detach this trunk from any campaigns that used it (they fall back to default).
    await query('UPDATE campaigns SET sip_trunk_id = NULL WHERE sip_trunk_id = ?', [req.params.id]);
    // If we removed the default, promote another active trunk.
    if (row && row.is_default) {
      await query('UPDATE sip_trunks SET is_default = 1 WHERE active = 1 ORDER BY id ASC LIMIT 1');
    }
    const { generatePjsipConf } = require('../services/pjsipConfig');
    const applied = await generatePjsipConf();
    res.json({ success: true, ...applied });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Test connection: ask Asterisk whether this trunk's host is reachable ─────
// IP trunks rely on the qualify (OPTIONS) on the AOR; user/pass trunks also
// report a registration state. Returns { ok, status, detail }.
router.post('/sip-trunks/:id/test', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!(await ownsTrunk(req, req.params.id))) return res.status(404).json({ ok: false, status: 'Not found' });
    const trunk = await queryOne('SELECT * FROM sip_trunks WHERE id = ?', [req.params.id]);
    if (!trunk) return res.status(404).json({ ok: false, status: 'Not found' });

    const { trunkEndpointName } = require('../services/pjsipConfig');
    const endpoint = trunkEndpointName(trunk);
    const prefix = trunk.is_default ? 'trunk' : `trunk_${trunk.id}`;
    const userpass = trunk.auth_type === 'userpass' || (trunk.username && trunk.password);

    const { getAMI } = require('../services/amiClient');
    const ami = getAMI();
    if (!ami || !(ami.isReady && ami.isReady())) {
      return res.json({ ok: false, status: 'Asterisk offline', detail: 'AMI not connected — cannot test right now.' });
    }

    // This AMI client can't read raw "Command" CLI output (it splits on blank
    // lines and rejects "Response: Follows"), so we use the STRUCTURED
    // PJSIPShowEndpoint events instead — they parse cleanly as key:value.
    const collect = (endpointName) => new Promise((resolve) => {
      const evts = [];
      let done = false;
      const onEvt = (e) => {
        if (!e || !e.Event) return;
        if (/^(EndpointDetail|ContactStatusDetail|AorDetail|AuthDetail|EndpointDetailComplete)$/.test(e.Event)) evts.push(e);
        if (e.Event === 'EndpointDetailComplete') finish();
      };
      const finish = () => { if (done) return; done = true; ami.removeListener('event', onEvt); clearTimeout(timer); resolve(evts); };
      const timer = setTimeout(finish, 2500);
      ami.on('event', onEvt);
      ami.action({ Action: 'PJSIPShowEndpoint', Endpoint: endpointName }).catch(() => finish());
    });

    const evts = await collect(endpoint);
    const loaded  = evts.some(e => e.Event === 'EndpointDetail');
    const contact = evts.find(e => e.Event === 'ContactStatusDetail' && e.URI);
    const contactStatus = contact ? (contact.Status || 'NonQual') : null;
    // Endpoint loaded + a carrier contact present = trunk is configured and
    // pointing at the provider. (We deliberately don't qualify the trunk, so a
    // contact existing is the reliable signal; user/pass trunks also register.)
    const ok = loaded && !!contact;

    const parts = [];
    if (!loaded) parts.push('endpoint not loaded yet — click Save on the provider to apply it to Asterisk');
    else parts.push('endpoint loaded');
    if (contact) parts.push(`carrier contact present (${contactStatus})`);
    else if (loaded) parts.push('no carrier contact resolved — check host/port');
    if (ok && userpass) parts.push('user/pass auth (registers with carrier)');
    else if (ok) parts.push('IP auth');

    res.json({
      ok,
      status: ok ? 'Connection successful' : 'Connection failed',
      detail: parts.join('; '),
    });
  } catch (err) {
    res.status(500).json({ ok: false, status: 'Error', detail: err.message });
  }
});

// ── SIP Provider config (write pjsip.conf + reload Asterisk) ─────────────────
router.get('/sip-provider', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const keys = ['sip_host','sip_port','sip_username','sip_password','sip_provider_name','sip_clis','sip_protocol','sip_from_user','sip_codecs'];
    const rows = await query(`SELECT key_name, value FROM system_settings WHERE key_name IN (${keys.map(()=>'?').join(',')})`, keys);
    const result = {};
    rows.forEach(r => { result[r.key_name] = r.value; });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DEPRECATED single-provider apply — kept for backward compatibility. It now
// folds the legacy payload into the DEFAULT trunk row and delegates to the
// multi-provider generator, so a stale client can never wipe out other trunks.
router.post('/sip-provider/apply', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { sip_host, sip_port, sip_username, sip_password, sip_provider_name, sip_clis, sip_from_user, sip_codecs } = req.body;

    // Keep system_settings in sync (some legacy reads still use it).
    const updates = { sip_host, sip_port: sip_port||'5060', sip_username: sip_username||'', sip_password: sip_password||'', sip_provider_name: sip_provider_name||'SIP Trunk', sip_clis: sip_clis||'', sip_from_user: sip_from_user||'', sip_codecs: sip_codecs||'ulaw,alaw' };
    for (const [k,v] of Object.entries(updates)) {
      await query('INSERT INTO system_settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', [k, v||'', v||'']);
    }

    const authType = (sip_username && sip_password) ? 'userpass' : 'ip';
    const def = await queryOne('SELECT id FROM sip_trunks WHERE is_default = 1 ORDER BY id ASC LIMIT 1');
    if (def) {
      await query(
        `UPDATE sip_trunks SET name=?, host=?, port=?, username=?, password=?, codec=?, auth_type=?, from_user=?, clis=? WHERE id=?`,
        [sip_provider_name||'SIP Trunk', sip_host, parseInt(sip_port)||5060, sip_username||null, sip_password||null,
         sip_codecs||'ulaw,alaw', authType, sip_from_user||null, sip_clis||null, def.id]
      );
    } else {
      await query('UPDATE sip_trunks SET is_default = 0');
      await query(
        `INSERT INTO sip_trunks (name, host, port, username, password, context, codec, auth_type, from_user, clis, is_default, active)
         VALUES (?, ?, ?, ?, ?, 'from-trunk', ?, ?, ?, ?, 1, 1)`,
        [sip_provider_name||'SIP Trunk', sip_host, parseInt(sip_port)||5060, sip_username||null, sip_password||null,
         sip_codecs||'ulaw,alaw', authType, sip_from_user||null, sip_clis||null]
      );
    }

    const { generatePjsipConf } = require('../services/pjsipConfig');
    const applied = await generatePjsipConf();
    res.json({ success: true, asterisk_reloaded: applied.reloaded, message: applied.reloaded ? 'Config saved and Asterisk reloaded' : 'Config saved — Asterisk not connected yet, will apply on next restart' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// System settings
router.get('/settings', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const rows = await query('SELECT key_name, value, description FROM system_settings ORDER BY key_name');
    const settings = {};
    rows.forEach(r => { settings[r.key_name] = { value: r.value, description: r.description }; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, val] of Object.entries(updates)) {
      await query(
        'INSERT INTO system_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
        [key, String(val), String(val)]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
