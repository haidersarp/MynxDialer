const { getPool } = require('./connection');

const tables = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    full_name VARCHAR(100),
    role ENUM('admin','supervisor','agent') DEFAULT 'agent',
    extension VARCHAR(20),
    sip_password VARCHAR(100),
    status ENUM('online','offline','available','oncall','paused') DEFAULT 'offline',
    active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    dial_method ENUM('preview','progressive','predictive','power') DEFAULT 'progressive',
    dial_ratio DECIMAL(4,2) DEFAULT 1.0,
    max_attempts INT DEFAULT 3,
    retry_delay INT DEFAULT 3600,
    cid_group_id INT,
    queue_name VARCHAR(50) DEFAULT 'default',
    script TEXT,
    timezone VARCHAR(50) DEFAULT 'Europe/London',
    start_time TIME DEFAULT '08:00:00',
    end_time TIME DEFAULT '21:00:00',
    amd_enabled TINYINT DEFAULT 0,
    record_calls TINYINT DEFAULT 0,
    status ENUM('inactive','active','paused') DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(100),
    address VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(50),
    zip VARCHAR(20),
    custom_fields JSON,
    status ENUM('new','called','answered','no_answer','busy','failed','dnc','completed','callback') DEFAULT 'new',
    attempts INT DEFAULT 0,
    last_attempt TIMESTAMP NULL,
    last_disposition VARCHAR(50),
    assigned_agent INT,
    callback_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_campaign_status (campaign_id, status),
    INDEX idx_phone (phone),
    INDEX idx_callback (callback_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS calls (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT,
    lead_id INT,
    agent_id INT,
    caller_id VARCHAR(20),
    channel VARCHAR(100),
    agent_channel VARCHAR(100),
    uniqueid VARCHAR(50),
    status ENUM('ringing','answered','no_answer','busy','failed','abandoned') DEFAULT 'ringing',
    direction ENUM('inbound','outbound') DEFAULT 'outbound',
    duration INT DEFAULT 0,
    recording_file VARCHAR(255),
    disposition_id INT,
    disposition_code VARCHAR(50),
    notes TEXT,
    called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    answered_at TIMESTAMP NULL,
    hung_up_at TIMESTAMP NULL,
    INDEX idx_agent_date (agent_id, called_at),
    INDEX idx_campaign_date (campaign_id, called_at),
    INDEX idx_uniqueid (uniqueid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS caller_id_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    rotation_type ENUM('sequential','random','round_robin') DEFAULT 'round_robin',
    last_used_index INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS caller_ids (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    number VARCHAR(20) NOT NULL,
    description VARCHAR(100),
    active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_group (group_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS dispositions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT,
    code VARCHAR(20) NOT NULL,
    label VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT '#666666',
    is_sale TINYINT DEFAULT 0,
    is_dnc TINYINT DEFAULT 0,
    is_callback TINYINT DEFAULT 0,
    is_appointment TINYINT DEFAULT 0,
    active TINYINT DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_campaign (campaign_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS agent_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agent_id INT NOT NULL,
    campaign_id INT,
    logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logged_out_at TIMESTAMP NULL,
    status ENUM('available','oncall','paused','wrapup') DEFAULT 'available',
    pause_code_id INT,
    INDEX idx_agent (agent_id),
    INDEX idx_active (agent_id, logged_out_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS callbacks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lead_id INT NOT NULL,
    agent_id INT,
    campaign_id INT,
    scheduled_at TIMESTAMP NOT NULL,
    notes TEXT,
    status ENUM('pending','completed','missed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent_scheduled (agent_id, scheduled_at),
    INDEX idx_status (status, scheduled_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS dnc_list (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    added_by INT,
    reason VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone (phone)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS pause_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    label VARCHAR(100) NOT NULL,
    billable TINYINT DEFAULT 0,
    active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sip_trunks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    host VARCHAR(100) NOT NULL,
    port INT DEFAULT 5060,
    username VARCHAR(100),
    password VARCHAR(100),
    context VARCHAR(50) DEFAULT 'from-trunk',
    codec VARCHAR(100) DEFAULT 'ulaw,alaw',
    active TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    key_name VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    description VARCHAR(255)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function initDB() {
  const pool = getPool();
  let retries = 10;
  while (retries > 0) {
    try {
      const conn = await pool.getConnection();
      conn.release();
      break;
    } catch (err) {
      retries--;
      if (retries === 0) throw new Error('Could not connect to MySQL: ' + err.message);
      console.log(`[DB] Waiting for MySQL... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  for (const sql of tables) {
    await pool.execute(sql);
  }
  // Safely add new columns to existing tables
  const alterations = [
    'ALTER TABLE dispositions ADD COLUMN is_appointment TINYINT DEFAULT 0',
    'ALTER TABLE campaigns ADD COLUMN hopper_level INT DEFAULT 100',
    'ALTER TABLE leads ADD COLUMN list_id INT NULL',
    'ALTER TABLE leads ADD INDEX idx_list (list_id)',
    // ── Multi-SIP-provider support ──────────────────────────────────────────
    // Each campaign can pick which SIP trunk (provider) carries its outbound calls.
    'ALTER TABLE campaigns ADD COLUMN sip_trunk_id INT NULL',
    // Per-trunk extras: IP vs user/pass auth, the From user, the trunk\'s own CLIs,
    // an explicit default flag, and a stable pjsip section slug.
    "ALTER TABLE sip_trunks ADD COLUMN auth_type ENUM('ip','userpass') DEFAULT 'ip'",
    'ALTER TABLE sip_trunks ADD COLUMN from_user VARCHAR(50)',
    'ALTER TABLE sip_trunks ADD COLUMN clis TEXT',
    'ALTER TABLE sip_trunks ADD COLUMN is_default TINYINT DEFAULT 0',
    // Allow predictive dial ratios up to 100+ (DECIMAL(4,2) capped at 99.99).
    'ALTER TABLE campaigns MODIFY COLUMN dial_ratio DECIMAL(5,2) DEFAULT 1.0',
    // Hopper auto-refill: refill back up to hopper_level once it drains to this
    // low-water mark. hopper_level can now go up to 10000.
    'ALTER TABLE campaigns ADD COLUMN hopper_threshold INT DEFAULT 100',
    // CID groups can declare which SIP trunk their CLIs belong to and which
    // campaign they serve (campaign_id NULL = all campaigns).
    'ALTER TABLE caller_id_groups ADD COLUMN sip_trunk_id INT NULL',
    'ALTER TABLE caller_id_groups ADD COLUMN campaign_id INT NULL',
    // Admin follow-up status for a sale/appointment (NULL/pending = new, then
    // the admin marks it accepted or cancelled after calling back).
    "ALTER TABLE calls ADD COLUMN appointment_status ENUM('pending','accepted','cancelled') DEFAULT 'pending'",
    // Recycle-with-delay: a "don't dial until" time on the lead. When a lead is
    // recycled with a delay, it's reset to 'new' (so it shows as New) but the
    // hopper ignores it until NOW() passes not_before. NULL = dial immediately.
    'ALTER TABLE leads ADD COLUMN not_before DATETIME NULL',
    'ALTER TABLE leads ADD INDEX idx_not_before (not_before)',
    // ── Multi-tenant: accounts + account_id on every tenant table ────────────
    // NOTE: 'trainee' MUST stay in this list. This statement re-runs on every
    // backend start — if trainee were appended as a separate ALTER instead,
    // this line would strip it again on the next restart and orphan every
    // trainee row. Appending at the END of the enum keeps it an INSTANT
    // operation in MySQL 8 (no table rebuild, no lock, safe with live calls).
    "ALTER TABLE users MODIFY COLUMN role ENUM('admin','supervisor','agent','super_admin','trainee') NULL DEFAULT 'agent'",
    'ALTER TABLE users ADD COLUMN account_id INT NULL DEFAULT NULL',
    'ALTER TABLE users ADD INDEX idx_account (account_id)',
    'ALTER TABLE campaigns ADD COLUMN account_id INT NULL DEFAULT NULL',
    'ALTER TABLE campaigns ADD INDEX idx_account (account_id)',
    'ALTER TABLE sip_trunks ADD COLUMN account_id INT NULL DEFAULT NULL',
    'ALTER TABLE sip_trunks ADD INDEX idx_account (account_id)',
    'ALTER TABLE caller_id_groups ADD COLUMN account_id INT NULL DEFAULT NULL',
    'ALTER TABLE caller_id_groups ADD INDEX idx_account (account_id)',
    'ALTER TABLE lead_lists ADD COLUMN account_id INT NULL DEFAULT NULL',
    'ALTER TABLE lead_lists ADD INDEX idx_account (account_id)',
    'ALTER TABLE accounts ADD COLUMN suspend_reason VARCHAR(40) NULL',
  ];
  for (const sql of alterations) {
    try { await pool.execute(sql); } catch (_) {}
  }

  // Preserve existing CID-group assignments now that they live on the group:
  // a group previously linked via campaigns.cid_group_id keeps serving that
  // campaign; existing groups default to the default SIP trunk (their CLIs are
  // that carrier's numbers).
  try {
    await pool.execute(
      `UPDATE caller_id_groups g
       SET g.campaign_id = (SELECT MIN(c.id) FROM campaigns c WHERE c.cid_group_id = g.id)
       WHERE g.campaign_id IS NULL AND EXISTS (SELECT 1 FROM campaigns c2 WHERE c2.cid_group_id = g.id)`
    );
    await pool.execute(
      `UPDATE caller_id_groups SET sip_trunk_id = (SELECT id FROM sip_trunks WHERE is_default = 1 LIMIT 1)
       WHERE sip_trunk_id IS NULL`
    );
  } catch (e) { console.log('[DB] CID group link backfill skipped:', e.message); }

  // ── Seed the admin-configurable answering-machine hold (ACD padding) ───────
  // Default 7s; surfaced on Settings → System, synced to AstDB by the dialer and
  // read by the lead-wait dialplan. INSERT IGNORE = never clobbers an admin value.
  try {
    await pool.execute(
      "INSERT IGNORE INTO system_settings (key_name, value, description) VALUES ('machine_linger_seconds', '7', 'Answering-machine hold before hangup (sec, 0-20) — pads carrier ACD; does not affect dialing')"
    );
  } catch (e) { console.log('[DB] machine_linger seed skipped:', e.message); }

  // ── Seed the existing Default Provider trunk into sip_trunks (one-time) ───────────────
  // The live system has Default Provider wired in pjsip.conf as [trunk_endpoint]. Pull its
  // values from the old single-provider system_settings (or fall back to the
  // known-good Default Provider defaults) so the multi-provider UI shows it as the default
  // provider and campaigns can select it — without changing any Asterisk config.
  try {
    const [trunkRows] = await pool.execute('SELECT COUNT(*) AS n FROM sip_trunks');
    if (trunkRows[0].n === 0) {
      const settingKeys = ['sip_host','sip_port','sip_username','sip_password','sip_provider_name','sip_clis','sip_from_user','sip_codecs'];
      const [sRows] = await pool.execute(
        `SELECT key_name, value FROM system_settings WHERE key_name IN (${settingKeys.map(()=>'?').join(',')})`,
        settingKeys
      );
      const s = {};
      sRows.forEach(r => { s[r.key_name] = r.value; });
      const host = s.sip_host || 'sip.your-provider.com';
      const user = s.sip_username || '';
      const pass = s.sip_password || '';
      const fromUser = s.sip_from_user || '441234567890';
      const clis = s.sip_clis || '01234567890';
      const name = s.sip_provider_name || 'Default Provider';
      const codec = s.sip_codecs || 'ulaw,alaw';
      const authType = (user && pass) ? 'userpass' : 'ip';
      await pool.execute(
        `INSERT INTO sip_trunks (name, host, port, username, password, context, codec, auth_type, from_user, clis, is_default, active)
         VALUES (?, ?, ?, ?, ?, 'from-trunk', ?, ?, ?, ?, 1, 1)`,
        [name, host, parseInt(s.sip_port) || 5060, user, pass, codec, authType, fromUser, clis]
      );
      console.log('[DB] Seeded default SIP trunk (Default Provider) into sip_trunks');
    }
  } catch (e) { console.log('[DB] SIP trunk seed skipped:', e.message); }

  // Lead lists table
  await pool.execute(`CREATE TABLE IF NOT EXISTS lead_lists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    original_filename VARCHAR(255),
    total_rows INT DEFAULT 0,
    imported_count INT DEFAULT 0,
    duplicate_count INT DEFAULT 0,
    skipped_count INT DEFAULT 0,
    active TINYINT DEFAULT 1,
    dial_order ENUM('asc','desc') DEFAULT 'asc',
    dial_mode ENUM('simultaneous','sequential') DEFAULT 'simultaneous',
    column_mapping JSON,
    seq_position INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_campaign (campaign_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Agent campaign access table
  await pool.execute(`CREATE TABLE IF NOT EXISTS agent_campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agent_id INT NOT NULL,
    campaign_id INT NOT NULL,
    UNIQUE KEY idx_agent_campaign (agent_id, campaign_id),
    INDEX idx_agent (agent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Hopper table
  await pool.execute(`CREATE TABLE IF NOT EXISTS hopper (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    lead_id INT NOT NULL,
    priority INT DEFAULT 50,
    status ENUM('ready','dialing') DEFAULT 'ready',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY idx_lead_campaign (lead_id, campaign_id),
    INDEX idx_campaign_ready (campaign_id, status, priority, added_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Internal team chat messages (admin↔agent broadcast, 1:1 DMs, team room)
  await pool.execute(`CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    channel ENUM('team','broadcast','dm') NOT NULL DEFAULT 'team',
    sender_id INT NOT NULL,
    recipient_id INT DEFAULT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_channel_created (channel, created_at),
    INDEX idx_dm (sender_id, recipient_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Admin's review comment on a booked lead (sale/appointment), shown to the
  // agent in their Booked Leads panel. Add the column if it doesn't exist yet.
  // ADD COLUMN is an INSTANT, metadata-only change in MySQL 8 — safe on the live
  // calls table (no rebuild, no blocking, no impact on in-flight calls).
  try {
    const [colRows] = await pool.execute(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calls' AND COLUMN_NAME = 'appointment_note'"
    );
    if (!colRows[0].n) {
      await pool.execute('ALTER TABLE calls ADD COLUMN appointment_note TEXT NULL');
      console.log('[DB] Added calls.appointment_note');
    }
  } catch (e) { console.warn('[DB] appointment_note column check skipped:', e.message); }

  // status_changed_at + trigger: timestamp of the agent's LAST status change,
  // powering the Live Monitor per-state timers (waiting / on-break / idle). The
  // BEFORE-UPDATE trigger captures EVERY status change regardless of which code
  // path caused it (agent pausing, dialer putting them on a call, etc.).
  try {
    const [c] = await pool.query(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'status_changed_at'"
    );
    if (!c[0].n) {
      await pool.query('ALTER TABLE users ADD COLUMN status_changed_at TIMESTAMP NULL');
      await pool.query('UPDATE users SET status_changed_at = NOW() WHERE status_changed_at IS NULL');
      console.log('[DB] Added users.status_changed_at');
    }
    // Log of completed status intervals — powers Reports "On Break" / "Idle" totals.
    await pool.query(`CREATE TABLE IF NOT EXISTS agent_status_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      agent_id INT NOT NULL,
      status VARCHAR(20),
      started_at TIMESTAMP NULL,
      ended_at TIMESTAMP NULL,
      duration_sec INT,
      INDEX idx_agent_day (agent_id, ended_at),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // The trigger now ALSO records the just-finished interval (OLD status, from its
    // start until now) into agent_status_log whenever status changes — so we can
    // sum how long each agent spent paused / online-idle over a day.
    await pool.query('DROP TRIGGER IF EXISTS users_status_changed');
    await pool.query(
      `CREATE TRIGGER users_status_changed BEFORE UPDATE ON users FOR EACH ROW
       BEGIN
         IF NEW.status <> OLD.status THEN
           IF OLD.status_changed_at IS NOT NULL THEN
             INSERT INTO agent_status_log (agent_id, status, started_at, ended_at, duration_sec)
               VALUES (OLD.id, OLD.status, OLD.status_changed_at, NOW(),
                       TIMESTAMPDIFF(SECOND, OLD.status_changed_at, NOW()));
           END IF;
           SET NEW.status_changed_at = NOW();
         END IF;
       END`
    );
    console.log('[DB] users_status_changed trigger + agent_status_log ensured');
  } catch (e) { console.warn('[DB] status_changed_at setup skipped:', e.message); }

  // Chat upgrades: per-campaign channel + priority popups + attachments.
  try {
    const need = async (col, ddl) => {
      const [c] = await pool.query(
        "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = ?",
        [col]
      );
      if (!c[0].n) { await pool.query(`ALTER TABLE messages ADD COLUMN ${ddl}`); console.log(`[DB] Added messages.${col}`); }
    };
    await need('campaign_id',     'campaign_id INT NULL');
    await need('priority',        'priority TINYINT DEFAULT 0');
    await need('attachment_url',  'attachment_url VARCHAR(512) NULL');
    await need('attachment_name', 'attachment_name VARCHAR(255) NULL');
    await need('attachment_type', 'attachment_type VARCHAR(20) NULL');
    const [ch] = await pool.query(
      "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'channel'"
    );
    if (ch[0] && !/'campaign'/.test(ch[0].COLUMN_TYPE)) {
      await pool.query("ALTER TABLE messages MODIFY COLUMN channel ENUM('team','broadcast','dm','campaign') NOT NULL DEFAULT 'team'");
      console.log('[DB] messages.channel enum += campaign');
    }
  } catch (e) { console.warn('[DB] chat schema upgrade skipped:', e.message); }

  // ── Accounts (multi-tenant) — Account 1 is the default tenant ──
  await pool.execute(`CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    status ENUM('active','suspended') NOT NULL DEFAULT 'active',
    max_agents INT DEFAULT NULL,
    max_campaigns INT DEFAULT NULL,
    ext_range_start INT DEFAULT NULL,
    ext_range_end INT DEFAULT NULL,
    suspend_reason VARCHAR(40) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.execute(`INSERT INTO accounts (id, name, status, ext_range_start, ext_range_end)
    VALUES (1, 'Main Account', 'active', 1001, 1099)
    ON DUPLICATE KEY UPDATE name = name`);
  // Backfill any un-tagged rows to Account 1
  for (const t of ['users','campaigns','sip_trunks','caller_id_groups','lead_lists']) {
    try { await pool.execute(`UPDATE ${t} SET account_id = 1 WHERE account_id IS NULL`); } catch (_) {}
  }

  // ── Trainee notes (Trainee portal) ──
  // Notes a trainee writes while shadowing an agent. Kept per-account so they
  // follow the same tenant isolation as every other table. agent_id/call_id/
  // lead_id are the context captured at write time and are intentionally
  // nullable + ON DELETE SET NULL: a note is a coaching record and must
  // outlive the call or lead it was taken against.
  await pool.execute(`CREATE TABLE IF NOT EXISTS trainee_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trainee_id INT NOT NULL,
    account_id INT NULL,
    agent_id INT NULL,
    call_id INT NULL,
    lead_id INT NULL,
    agent_name VARCHAR(120) NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_trainee (trainee_id),
    INDEX idx_account (account_id),
    INDEX idx_agent (agent_id),
    INDEX idx_created (created_at),
    CONSTRAINT fk_tnote_trainee FOREIGN KEY (trainee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_tnote_agent   FOREIGN KEY (agent_id)   REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── DNC list per-account isolation ──
  // dnc_list was global (UNIQUE(phone)); make it per-tenant so each account keeps
  // its own Do-Not-Call list. Add account_id, backfill existing rows to Account 1,
  // and swap the global unique key for a composite one (account_id, phone).
  {
    const [dncCol] = await pool.execute(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dnc_list' AND column_name = 'account_id'"
    );
    if (!dncCol[0].n) {
      await pool.execute('ALTER TABLE dnc_list ADD COLUMN account_id INT NULL AFTER phone');
      await pool.execute('UPDATE dnc_list SET account_id = 1 WHERE account_id IS NULL');
      await pool.execute('CREATE INDEX idx_dnc_account ON dnc_list (account_id)');
      console.log('[DB] Added dnc_list.account_id');
    }
    // Replace the global UNIQUE(phone) with UNIQUE(account_id, phone) if not done yet.
    const [uniq] = await pool.execute(
      "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'dnc_list' AND index_name = 'uniq_acct_phone'"
    );
    if (!uniq[0].n) {
      try { await pool.execute('ALTER TABLE dnc_list DROP INDEX phone'); } catch (_) {}
      await pool.execute('ALTER TABLE dnc_list ADD UNIQUE KEY uniq_acct_phone (account_id, phone)');
      console.log('[DB] dnc_list unique key is now (account_id, phone)');
    }
  }

  console.log('[DB] Migrations complete');
}

module.exports = { initDB };
