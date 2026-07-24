// ─────────────────────────────────────────────────────────────────────────────
// tenant.js — multi-tenant scoping helpers.
//
// req.user.account_id is the caller's tenant (set by the auth middleware).
// A super_admin has account_id = NULL and BYPASSES all scoping (sees every
// account). Every other role is confined to its own account.
//
//   • accountClause(req, alias)  — WHERE fragment for tables WITH account_id
//     (users, campaigns, sip_trunks, caller_id_groups, lead_lists)
//   • campaignClause(req, alias) — WHERE fragment for campaign-keyed tables
//     (leads, calls, hopper, callbacks…) — constrains to the account's campaigns
//   • getOwned* — load a row and return it only if it belongs to the caller
//     (else null → the handler should 404). super_admin always gets the row.
// ─────────────────────────────────────────────────────────────────────────────
const { query } = require('../db/connection');

function tenant(req) {
  const u = (req && req.user) || {};
  if (u.role === 'super_admin') return { superAdmin: true, accountId: null };
  return { superAdmin: false, accountId: u.account_id || 0 }; // 0 matches nothing
}

function accountClause(req, alias) {
  const t = tenant(req);
  if (t.superAdmin) return { clause: '', params: [] };
  const col = alias ? `${alias}.account_id` : 'account_id';
  return { clause: ` AND ${col} = ?`, params: [t.accountId] };
}

function campaignClause(req, alias) {
  const t = tenant(req);
  if (t.superAdmin) return { clause: '', params: [] };
  const col = alias ? `${alias}.campaign_id` : 'campaign_id';
  return { clause: ` AND ${col} IN (SELECT id FROM campaigns WHERE account_id = ?)`, params: [t.accountId] };
}

// The caller's account id to stamp on INSERTs (NULL for super_admin).
function accountId(req) { return tenant(req).accountId; }

// ── Load-owned-row helpers: return the row, or null if it isn't the caller's ──
async function getOwnedCampaign(req, id) {
  if (!id) return null;
  const c = (await query('SELECT * FROM campaigns WHERE id = ?', [id]))[0];
  if (!c) return null;
  const t = tenant(req);
  return (t.superAdmin || c.account_id == t.accountId) ? c : null;
}
async function getOwnedUser(req, id) {
  if (!id) return null;
  const u = (await query('SELECT * FROM users WHERE id = ?', [id]))[0];
  if (!u) return null;
  const t = tenant(req);
  return (t.superAdmin || u.account_id == t.accountId) ? u : null;
}
// A row in any table that has an account_id column (caller_id_groups, lead_lists…)
async function getOwnedRow(req, table, id) {
  if (!id) return null;
  const r = (await query(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];
  if (!r) return null;
  const t = tenant(req);
  return (t.superAdmin || r.account_id == t.accountId) ? r : null;
}
// A lead is owned when its campaign is.
async function getOwnedLead(req, id) {
  if (!id) return null;
  const r = (await query(
    `SELECT l.*, c.account_id AS _acct FROM leads l JOIN campaigns c ON c.id = l.campaign_id WHERE l.id = ?`, [id]))[0];
  if (!r) return null;
  const t = tenant(req);
  return (t.superAdmin || r._acct == t.accountId) ? r : null;
}
// A call is owned when its campaign is.
async function getOwnedCall(req, id) {
  if (!id) return null;
  const r = (await query(
    `SELECT c.*, cp.account_id AS _acct FROM calls c LEFT JOIN campaigns cp ON cp.id = c.campaign_id WHERE c.id = ?`, [id]))[0];
  if (!r) return null;
  const t = tenant(req);
  return (t.superAdmin || r._acct == t.accountId) ? r : null;
}

module.exports = {
  tenant, accountId, accountClause, campaignClause,
  getOwnedCampaign, getOwnedUser, getOwnedRow, getOwnedLead, getOwnedCall,
};
