const jwt = require('jsonwebtoken');
const { queryOne } = require('../db/connection');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme');
    const user = await queryOne(
      'SELECT u.id, u.username, u.email, u.full_name, u.role, u.extension, u.status, u.account_id, a.status AS account_status, a.suspend_reason, a.name AS account_name FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.id = ? AND u.active = 1',
      [decoded.id]
    );
    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ── Trainee firewall ────────────────────────────────────────────────────────
// Most existing routes are `authenticate`-only with no role check (9 in
// calls.js, 4 in leads.js, …). Without this guard a trainee's token would be
// accepted by them — so a trainee could GET /api/leads and read the UNMASKED
// phone numbers that routes/trainee.js deliberately masks, defeating the whole
// point of masking.
//
// This is FAIL-CLOSED: a trainee is denied everything except the explicit
// allowlist below, so any route added later is automatically off-limits to
// trainees until someone consciously allows it.
//
// Mounted at '/api', so `path` here is the sub-path, e.g. '/leads/123'.
const TRAINEE_ALLOWED = [
  /^\/trainee(\/|$)/,      // the trainee API itself
  /^\/auth\/login$/,       // sign in
  /^\/auth\/me$/,          // who am I
  /^\/auth\/logout$/,      // sign out
  /^\/sip\/config$/,       // their own listen-only WebRTC credentials
];

function traineeFirewall(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next(); // let routes 401

  let role;
  try {
    role = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'changeme').role;
  } catch (_) {
    return next(); // invalid token — the route's authenticate will reject it
  }
  if (role !== 'trainee') return next();

  const path = req.path || '';
  if (TRAINEE_ALLOWED.some(re => re.test(path))) return next();

  return res.status(403).json({ error: 'Not available to trainee accounts' });
}

module.exports = { authenticate, requireRole, traineeFirewall };
