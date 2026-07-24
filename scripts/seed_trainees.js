// ─────────────────────────────────────────────────────────────────────────────
// seed_trainees.js — create example trainee (listen-only) accounts.
//
// Run INSIDE the backend container (it has bcryptjs + DB access):
//   docker exec -i mynxdialer_backend node /app/scripts/seed_trainees.js
//
// Passwords are generated randomly at run time and printed once — they are NOT
// stored in this file. Idempotent and non-destructive:
//   • an existing username is SKIPPED, never overwritten
//   • an extension already in use by anyone is SKIPPED with a warning
// Re-running is safe. Nothing here touches calls, campaigns or agents.
//
// Configure via env:
//   TRAINEE_COUNT       how many to create (default 5)
//   TRAINEE_ACCOUNT_ID  which tenant account they belong to (default 1)
// ─────────────────────────────────────────────────────────────────────────────
// bcryptjs (NOT bcrypt) — that is what the backend image installs and what
// routes/auth.js verifies logins with. Using 'bcrypt' here would crash.
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

// Trainee SIP extensions start at 9001.
//
// ⚠ DO NOT move trainees into the 1xxx range. buildAgentPool() pre-generates
// PJSIP endpoints for the ENTIRE agent block (1001-1499) with
// context=from-internal. A trainee anywhere in that block would produce a
// DUPLICATE [ext] section in pjsip.conf — one from-trainee, one from-internal —
// and if the from-internal definition won, the trainee would get full outbound
// dialing and none of the listen-only restrictions. The 9001+ pool is clear of
// the agent pool and the admin extensions.
const EXT_START = 9001;
const COUNT = Number(process.env.TRAINEE_COUNT || 5);
const ACCOUNT_ID = Number(process.env.TRAINEE_ACCOUNT_ID || 1);

// A readable random password (no ambiguous chars), unique per run.
function genPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

const TRAINEES = Array.from({ length: COUNT }, (_, i) => ({
  username: `trainee${i + 1}`,
  full_name: `Trainee ${i + 1}`,
  ext: String(EXT_START + i),
  password: genPassword(),
}));

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'mysql',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  let created = 0, skipped = 0;

  for (const t of TRAINEES) {
    const [byName] = await conn.execute('SELECT id, role FROM users WHERE username = ?', [t.username]);
    if (byName.length) {
      console.log(`SKIP  ${t.username} — already exists (id ${byName[0].id}, role ${byName[0].role})`);
      skipped++; continue;
    }
    const [byExt] = await conn.execute('SELECT id, username FROM users WHERE extension = ?', [t.ext]);
    if (byExt.length) {
      console.log(`SKIP  ${t.username} — extension ${t.ext} already used by ${byExt[0].username}`);
      skipped++; continue;
    }

    const hash = await bcrypt.hash(t.password, 12);
    const sipPass = `trainee_sip_pass_${t.ext}`;
    await conn.execute(
      `INSERT INTO users (username, password, full_name, role, extension, sip_password, status, active, account_id)
       VALUES (?, ?, ?, 'trainee', ?, ?, 'offline', 1, ?)`,
      [t.username, hash, t.full_name, t.ext, sipPass, ACCOUNT_ID]
    );
    // Printed ONCE here — record it now; it is not stored anywhere in plain text.
    console.log(`OK    ${t.username}  ext ${t.ext}  password ${t.password}`);
    created++;
  }

  const [rows] = await conn.execute(
    "SELECT id, username, full_name, extension, account_id FROM users WHERE role = 'trainee' ORDER BY extension"
  );
  console.log(`\ncreated=${created} skipped=${skipped}`);
  console.table(rows);

  await conn.end();
  process.exit(0);
})().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
