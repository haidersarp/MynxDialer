// ─────────────────────────────────────────────────────────────────────────────
// pjsipConfig.js — generate /etc/asterisk/pjsip.conf from the sip_trunks table
//
// The file is: transports + every ACTIVE trunk + the working WebRTC agent pool.
// The DEFAULT trunk (is_default=1, else lowest id) is emitted as [trunk_endpoint]
// so the dialplan global (TRUNK=trunk_endpoint) and the manual-dial paths keep
// working unchanged. Every other trunk becomes [trunk_<id>_endpoint], which the
// dialer targets per-campaign by setting the TRUNK channel variable.
//
// NOTE: the agent pool block is emitted byte-for-byte the same every time, so a
// `module reload res_pjsip` after a trunk change never disturbs registered
// agents — only the trunk sections change.
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { query } = require('../db/connection');

// Your server's PUBLIC IP — set EXTERNAL_IP in .env for production so Asterisk
// advertises a reachable media/signaling address for WebRTC. Defaults to
// loopback for local development.
const EXTERNAL_IP = process.env.EXTERNAL_IP || '127.0.0.1';
// In the backend container the Asterisk conf dir is bind-mounted at
// /app/asterisk/conf (see docker-compose backend volumes). Use that absolute
// path; overridable via env for other environments.
const PJSIP_PATH = process.env.PJSIP_PATH || '/app/asterisk/conf/pjsip.conf';

// The pjsip section prefix for a trunk: the default owns the bare `trunk_*`
// names; others are namespaced by id.
function trunkPrefix(trunk) {
  return trunk.is_default ? 'trunk' : `trunk_${trunk.id}`;
}

// The endpoint section name the dialplan dials with `@${TRUNK}`.
function trunkEndpointName(trunk) {
  return `${trunkPrefix(trunk)}_endpoint`;
}

// Build the pjsip sections (identify/aor/endpoint [+ auth/registration]) for one trunk.
function buildTrunkSections(trunk) {
  const prefix   = trunkPrefix(trunk);
  const host     = trunk.host;
  const port     = trunk.port || 5060;
  const codecs   = (trunk.codec || 'ulaw,alaw').split(',').map(c => `allow=${c.trim()}`).filter(Boolean).join('\n');
  const clis     = (trunk.clis || '').split('\n').map(s => s.trim()).filter(Boolean);
  const fromUser = trunk.from_user || clis[0] || '';
  const userpass = trunk.auth_type === 'userpass' && trunk.username && trunk.password;

  // user/pass trunks register and use outbound auth. Matches the proven-working
  // Default Provider block (transport-udp, expiration=300, max_retries=0, no port in URIs).
  const authBlock = userpass ? `
[${prefix}_auth]
type=auth
auth_type=userpass
username=${trunk.username}
password=${trunk.password}

[${prefix}_reg]
type=registration
transport=transport-udp
outbound_auth=${prefix}_auth
server_uri=sip:${host}
client_uri=sip:${trunk.username}@${host}
retry_interval=60
max_retries=0
expiration=300
` : '';

  // NOTE: the AOR intentionally has NO qualify — the live Default Provider trunk runs
  // without it, and some carriers drop a static contact to "Unreachable" on a
  // missed OPTIONS, which can block outbound. Keep it identical to what works.
  return `
; ── Trunk: ${trunk.name} (${userpass ? 'user/pass' : 'IP'}) → ${trunkEndpointName(trunk)} ──
${authBlock}
[${prefix}_identify]
type=identify
match=${host}
endpoint=${prefix}_endpoint

[${prefix}_aor]
type=aor
contact=sip:${host}:${port}

[${prefix}_endpoint]
type=endpoint
context=from-trunk
disallow=all
${codecs}
aors=${prefix}_aor
${userpass ? `outbound_auth=${prefix}_auth` : ''}
direct_media=no
dtmf_mode=rfc4733
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
${fromUser ? `from_user=${fromUser}` : ''}
from_domain=${host}
send_pai=yes
trust_id_outbound=yes
`;
}

// The fixed transports header.
function buildTransports() {
  return `[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_media_address=${EXTERNAL_IP}
external_signaling_address=${EXTERNAL_IP}

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060
external_media_address=${EXTERNAL_IP}
external_signaling_address=${EXTERNAL_IP}

[transport-ws]
type=transport
protocol=ws
bind=0.0.0.0:8088
external_media_address=${EXTERNAL_IP}
external_signaling_address=${EXTERNAL_IP}
`;
}

// The working WebRTC agent pool (1001-1030) — MUST stay identical to the tuned
// pjsip.conf (ulaw/alaw only, provided DTLS cert, dtls_setup=passive,
// max_contacts=1, rtp_timeout=30). Do NOT regress to opus / auto-cert /
// max_contacts=3 — that breaks audio.
function buildAgentPool(defaultCli) {
  let pool = `
[agent-aor](!)
type=aor
max_contacts=1
qualify_frequency=0
remove_existing=yes

[agent-auth](!)
type=auth
auth_type=userpass

[agent-endpoint](!)
type=endpoint
context=from-internal
disallow=all
allow=ulaw
allow=alaw
dtls_cert_file=/etc/asterisk/dtls.crt
dtls_private_key=/etc/asterisk/dtls.key
webrtc=yes
rtp_timeout=30
transport=transport-ws
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=passive
ice_support=yes
media_use_received_transport=yes
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
direct_media=no
timers=no
`;
  for (let e = 1001; e <= 1499; e++) {
    pool += `\n[${e}](agent-auth)\nusername=${e}\npassword=agent_sip_pass_${e}\n[${e}](agent-aor)\n[${e}](agent-endpoint)\nauth=${e}\naors=${e}\ncallerid=Agent ${e} <${defaultCli || '01234567890'}>\n`;
  }
  return pool;
}

// Admin/supervisor WebRTC endpoints for Live Monitor (ChanSpy). Same working
// WebRTC template as agents, but context=from-admin (which carries the monitor
// feature codes *55/*56/*57). Pulled from the users table so each admin's real
// extension + sip_password match what /sip/config hands their browser.
async function buildAdminEndpoints() {
  let rows = [];
  try {
    rows = await query(
      "SELECT extension, sip_password FROM users WHERE role IN ('admin','supervisor') AND extension IS NOT NULL AND extension <> '' AND sip_password IS NOT NULL AND sip_password <> ''"
    );
  } catch (_) {}
  if (!rows.length) return '';
  let out = '\n;=== ADMIN/SUPERVISOR MONITOR ENDPOINTS (Live Monitor / ChanSpy) ===\n';
  for (const u of rows) {
    const e = u.extension;
    out += `\n[${e}](agent-auth)\nusername=${e}\npassword=${u.sip_password}\n[${e}](agent-aor)\n[${e}](agent-endpoint)\nauth=${e}\naors=${e}\ncontext=from-admin\ncallerid=Monitor <${e}>\n`;
  }
  return out;
}

// Trainee WebRTC endpoints for the Trainee portal (listen-only shadowing).
// Same working WebRTC template as agents/admins, but context=from-trainee —
// a context that carries ONLY *55 (silent listen) and denies everything else.
// Deliberately NOT from-admin: that context also exposes *56 whisper, *57
// barge and includes from-internal (outbound trunk), any of which would let a
// trainee be heard on a live call or place calls.
async function buildTraineeEndpoints() {
  let rows = [];
  try {
    rows = await query(
      "SELECT extension, sip_password FROM users WHERE role = 'trainee' AND extension IS NOT NULL AND extension <> '' AND sip_password IS NOT NULL AND sip_password <> ''"
    );
  } catch (_) {}
  if (!rows.length) return '';
  let out = '\n;=== TRAINEE ENDPOINTS (listen-only, context=from-trainee) ===\n';
  for (const u of rows) {
    const e = u.extension;
    // ⚠ SAFETY GUARD — do not remove.
    // buildAgentPool() pre-generates 1001-1499 with context=from-internal. A
    // trainee inside that block would emit a DUPLICATE [ext] section, and if
    // the from-internal one won, that trainee would get full outbound dialing
    // and none of the listen-only restrictions — silently defeating all three
    // security layers. Skip it loudly rather than emit an unsafe endpoint.
    const n = parseInt(e, 10);
    if (Number.isFinite(n) && n >= 1001 && n <= 1499) {
      out += `\n; SKIPPED trainee ext ${e} — collides with the agent pool (1001-1499).\n` +
             `; Reassign this trainee outside that range (9001+) or they cannot listen.\n`;
      console.error(`[pjsip] REFUSED trainee endpoint ${e}: inside agent pool 1001-1499 ` +
                    `(would duplicate a from-internal endpoint and bypass listen-only limits)`);
      continue;
    }
    out += `\n[${e}](agent-auth)\nusername=${e}\npassword=${u.sip_password}\n[${e}](agent-aor)\n[${e}](agent-endpoint)\nauth=${e}\naors=${e}\ncontext=from-trainee\ncallerid=Trainee <${e}>\n`;
  }
  return out;
}

// Fetch active trunks, ensure exactly one default, build the full file.
async function buildPjsipContent() {
  const trunks = await query('SELECT * FROM sip_trunks WHERE active = 1 ORDER BY is_default DESC, id ASC');
  // Guarantee a default so [trunk_endpoint] always exists.
  if (trunks.length && !trunks.some(t => t.is_default)) {
    trunks[0].is_default = 1;
  }
  const defaultTrunk = trunks.find(t => t.is_default) || trunks[0];
  const defaultCli = defaultTrunk
    ? (defaultTrunk.from_user || (defaultTrunk.clis || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '01234567890')
    : '01234567890';

  const trunkBlocks = trunks.map(buildTrunkSections).join('\n');

  return `; pjsip.conf — Generated by MynxDialer Admin (multi-provider)
; DO NOT EDIT MANUALLY — managed via Admin > Settings > SIP Providers
; ${trunks.length} active trunk(s); default = ${defaultTrunk ? defaultTrunk.name : 'none'}

${buildTransports()}
${trunkBlocks}
${buildAgentPool(defaultCli)}
${await buildAdminEndpoints()}
${await buildTraineeEndpoints()}`;
}

// Write pjsip.conf and reload res_pjsip via AMI. Returns {written, reloaded}.
async function generatePjsipConf() {
  const content = await buildPjsipContent();
  let written = false;
  try {
    fs.writeFileSync(PJSIP_PATH, content, 'utf8');
    written = true;
  } catch (e) {
    console.error('[pjsip] write failed:', e.message);
  }

  let reloaded = false;
  try {
    const { getAMI } = require('./amiClient');
    const ami = getAMI();
    if (ami && ami.isReady && ami.isReady()) {
      await ami.action({ Action: 'Command', Command: 'module reload res_pjsip' });
      reloaded = true;
    }
  } catch (e) {
    console.error('[pjsip] reload failed:', e.message);
  }
  try { await pushDefaultCliToAstdb(); } catch (_) {}
  return { written, reloaded };
}

// Resolve the endpoint name for a campaign's chosen trunk id (for the dialer).
// Falls back to the bare 'trunk_endpoint' (the default/global) when unset.
async function endpointForTrunkId(trunkId) {
  if (!trunkId) return 'trunk_endpoint';
  const rows = await query('SELECT * FROM sip_trunks WHERE id = ? AND active = 1', [trunkId]);
  if (!rows.length) return 'trunk_endpoint';
  return trunkEndpointName(rows[0]);
}

// ── Manual-dial default CLI → Asterisk astdb (read by the dialplan at call time) ─
// Normalize a UK CLI to on-wire international form (0xxxx -> 44xxxx).
function toIntlCli(n) {
  n = String(n || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('0')) return '44' + n.slice(1);
  return n;
}

// The default trunk's default CLI = its from_user, else its first CLI.
async function getDefaultCli() {
  const trunks = await query('SELECT id, from_user, clis, is_default FROM sip_trunks WHERE active = 1 ORDER BY is_default DESC, id ASC');
  const t = trunks.find(x => x.is_default) || trunks[0];
  if (!t) return '';
  const firstCli = (t.clis || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  return t.from_user || firstCli || '';
}

// Push the manual-dial default CLI into astdb via AMI. The dialplan reads
// ${DB(mynxdialer/default_cli)} at call time, so it applies on the next manual
// dial — no file write, no reload, no call disruption.
async function pushDefaultCliToAstdb() {
  const intl = toIntlCli(await getDefaultCli());
  if (!intl) return false;
  try {
    const { getAMI } = require('./amiClient');
    const ami = getAMI();
    if (ami && ami.isReady && ami.isReady()) {
      await ami.action({ Action: 'DBPut', Family: 'mynxdialer', Key: 'default_cli', Val: intl });
      return true;
    }
  } catch (e) {
    console.error('[astdb] push default_cli failed:', e.message);
  }
  return false;
}

module.exports = {
  generatePjsipConf,
  toIntlCli,
  getDefaultCli,
  pushDefaultCliToAstdb,
  buildPjsipContent,
  trunkEndpointName,
  endpointForTrunkId,
};