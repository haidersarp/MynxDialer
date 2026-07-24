const bcrypt = require('bcryptjs');
const { query, queryOne } = require('./connection');

async function seedDB() {
  // Default admin user
  const admin = await queryOne('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!admin) {
    const hash = await bcrypt.hash('admin123', 12);
    await query(
      `INSERT INTO users (username, password, email, full_name, role, extension, sip_password) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['admin', hash, 'admin@dialer.local', 'System Administrator', 'admin', '8000', 'admin_sip_pass']
    );
    console.log('[Seed] Default admin created (admin / admin123)');
  }

  // Default pause codes
  const pauseCount = await queryOne('SELECT COUNT(*) as c FROM pause_codes');
  if (pauseCount.c === 0) {
    const codes = [
      ['BRK', 'Break', 0],
      ['LUNCH', 'Lunch', 0],
      ['TRAIN', 'Training', 1],
      ['MEET', 'Meeting', 1],
      ['TECH', 'Tech Issue', 0]
    ];
    for (const [code, label, billable] of codes) {
      await query('INSERT INTO pause_codes (code, label, billable) VALUES (?, ?, ?)', [code, label, billable]);
    }
    console.log('[Seed] Default pause codes created');
  }

  // Default dispositions (global, campaign_id = NULL)
  const dispCount = await queryOne('SELECT COUNT(*) as c FROM dispositions WHERE campaign_id IS NULL');
  if (dispCount.c === 0) {
    // [code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order]
    const disps = [
      ['SALE',  'Sale',                '#3fb950', 1, 0, 0, 0, 1],
      ['CNC',   'Call Not Connected', '#ff5252', 0, 0, 0, 0, 0],
      ['APPT',  'Appointment Booked',  '#a855f7', 0, 0, 0, 1, 2],
      ['LB',    'Lead Booked',         '#8b5cf6', 0, 0, 0, 1, 3],
      ['NI',    'Not Interested',      '#f85149', 0, 0, 0, 0, 4],
      ['NA',    'No Answer',           '#8b949e', 0, 0, 0, 0, 5],
      ['BUSY',  'Busy',                '#d29922', 0, 0, 0, 0, 6],
      ['AM',    'Answering Machine',   '#58a6ff', 0, 0, 0, 0, 7],
      ['CB',    'Callback',            '#e3b341', 0, 0, 1, 0, 8],
      ['DNC',   'Do Not Call',         '#ff7b72', 0, 1, 0, 0, 9],
      ['DC',    'Disconnected',        '#8b949e', 0, 0, 0, 0, 10],
      ['LANG',  'Language Barrier',    '#8b949e', 0, 0, 0, 0, 11],
      ['HUNG',  'Hung Up',             '#f85149', 0, 0, 0, 0, 12]
    ];
    for (const [code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order] of disps) {
      await query(
        'INSERT INTO dispositions (campaign_id, code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
        [code, label, color, is_sale, is_dnc, is_callback, is_appointment, sort_order]
      );
    }
    console.log('[Seed] Default dispositions created');
  }

  // Default system settings
  const settings = [
    ['company_name',       'My Call Center',       'Company display name'],
    ['sip_provider_name',  'Carrier UK Trunk',     'SIP provider name'],
    ['sip_host',           'sip.your-provider.com',      'SIP provider host/IP'],
    ['sip_port',           '5060',                 'SIP provider port'],
    ['sip_username',       '',                     'SIP username (blank = IP auth)'],
    ['sip_password',       '',                     'SIP password (blank = IP auth)'],
    ['sip_from_user',      '01234567890',          'Default outbound CLI'],
    ['sip_clis',           '01234567890\n01234567891\n01234567892\n01234567893', 'Caller IDs (one per line)'],
    ['sip_codecs',         'ulaw,alaw',            'Allowed codecs'],
    ['company_name',       'My Call Center',       'Company display name'],
    ['max_calls_per_agent', '1', 'Max simultaneous calls per agent'],
    ['wrapup_time', '30', 'Agent wrapup time in seconds after call ends'],
    ['recording_enabled', '0', 'Enable call recording globally'],
    ['amd_enabled', '0', 'Enable Answering Machine Detection globally'],
    ['timezone', 'Europe/London', 'Default system timezone'],
    ['dial_prefix', '9', 'Outbound dial prefix'],
    ['ami_host', '127.0.0.1', 'Asterisk AMI host'],
    ['ami_port', '5038', 'Asterisk AMI port'],
    ['ami_user', 'dialer', 'Asterisk AMI username'],
    ['ami_secret', 'CHANGE_ME_AMI_SECRET', 'Asterisk AMI secret'],
    ['asterisk_host', '127.0.0.1', 'Asterisk server IP for SIP'],
    ['asterisk_ws_port', '8089', 'Asterisk WebSocket port for WebRTC'],
    ['asterisk_sip_port', '5060', 'Asterisk SIP port']
  ];

  for (const [key, val, desc] of settings) {
    await query(
      'INSERT IGNORE INTO system_settings (key_name, value, description) VALUES (?, ?, ?)',
      [key, val, desc]
    );
  }
  console.log('[Seed] System settings initialized');
}

module.exports = { seedDB };
