const express = require('express');
const { query, queryOne } = require('../db/connection');
const { authenticate, requireRole } = require('../middleware/auth');
const { accountClause, campaignClause, getOwnedCall } = require('../middleware/tenant');

const router = express.Router();

router.get('/summary', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { date_from, date_to, campaign_id } = req.query;
    const from = date_from || new Date().toISOString().split('T')[0];
    const to = date_to || from;
    // Optional per-campaign filter (dashboard dropdown). Blank/ALL = no filter.
    const camp = campaign_id && /^\d+$/.test(String(campaign_id)) ? parseInt(campaign_id) : null;
    const cc  = camp ? ' AND campaign_id = ?' : '';     // for plain `calls` queries
    const ccC = camp ? ' AND c.campaign_id = ?' : '';   // for aliased `c.` queries
    const P = (base) => camp ? [...base, camp] : base;  // append camp when filtering
    // Multi-tenant scoping (empty for super_admin).
    const sc  = campaignClause(req, '');   // bare `calls` -> AND campaign_id IN (...)
    const scC = campaignClause(req, 'c');  // aliased `c.` -> AND c.campaign_id IN (...)
    const su  = accountClause(req, '');     // bare users -> AND account_id = ?
    // Combine campaign filter + tenant scope. Tenant params come AFTER camp param.
    const PS  = (base) => [...P(base), ...sc.params];   // for `cc` queries
    const PSC = (base) => [...P(base), ...scC.params];  // for `ccC` queries

    const [total, answered, abandoned, sales, activeCalls, onlineAgents, avgDur] = await Promise.all([
      queryOne(`SELECT COUNT(*) as c FROM calls WHERE DATE(called_at) BETWEEN ? AND ?${cc}${sc.clause}`, PS([from, to])),
      queryOne(`SELECT COUNT(*) as c FROM calls WHERE status = 'answered' AND DATE(called_at) BETWEEN ? AND ?${cc}${sc.clause}`, PS([from, to])),
      queryOne(`SELECT COUNT(*) as c FROM calls WHERE status = 'abandoned' AND DATE(called_at) BETWEEN ? AND ?${cc}${sc.clause}`, PS([from, to])),
      queryOne(`SELECT COUNT(*) as c FROM calls c JOIN dispositions d ON d.id = c.disposition_id WHERE d.is_sale = 1 AND DATE(c.called_at) BETWEEN ? AND ?${ccC}${scC.clause}`, PSC([from, to])),
      queryOne(`SELECT COUNT(*) as c FROM calls WHERE hung_up_at IS NULL AND status IN ('ringing','answered')${cc}${sc.clause}`, PS([])),
      queryOne(`SELECT COUNT(*) as c FROM users WHERE status IN ('available','oncall','paused') AND active = 1${su.clause}`, su.params),
      // Average Call Duration (ACD) — mean talk time of connected calls in range
      queryOne(`SELECT ROUND(AVG(duration)) as d FROM calls WHERE status = 'answered' AND duration > 0 AND DATE(called_at) BETWEEN ? AND ?${cc}${sc.clause}`, PS([from, to]))
    ]);

    const hourly = await query(
      `SELECT HOUR(called_at) as hour, COUNT(*) as total,
       SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered
       FROM calls
       WHERE DATE(called_at) BETWEEN ? AND ?${cc}${sc.clause}
       GROUP BY HOUR(called_at) ORDER BY hour`,
      PS([from, to])
    );

    const byDisposition = await query(
      `SELECT d.label, d.color, COUNT(*) as count
       FROM calls c JOIN dispositions d ON d.id = c.disposition_id
       WHERE DATE(c.called_at) BETWEEN ? AND ?${ccC}${scC.clause}
       GROUP BY d.id ORDER BY count DESC`,
      PSC([from, to])
    );

    res.json({
      total_calls: total.c,
      answered_calls: answered.c,
      abandoned_calls: abandoned.c,
      sales: sales.c,
      active_calls: activeCalls.c,
      online_agents: onlineAgents.c,
      // Connection % = answered / total dials. Drop % = abandoned / connected.
      answer_rate: total.c > 0 ? ((answered.c / total.c) * 100).toFixed(1) : 0,
      drop_rate: answered.c > 0 ? ((abandoned.c / answered.c) * 100).toFixed(1) : 0,
      conversion_rate: answered.c > 0 ? ((sales.c / answered.c) * 100).toFixed(1) : 0,
      avg_duration: avgDur?.d || 0,
      hourly,
      by_disposition: byDisposition
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agent', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { date_from, date_to, agent_id, campaign_id } = req.query;
    const from = date_from || new Date().toISOString().split('T')[0];
    const to = date_to || from;
    const today = new Date().toISOString().split('T')[0];
    const includeLive = to >= today;   // add the agent's CURRENT ongoing interval only if the range reaches today
    const aid  = agent_id && /^\d+$/.test(String(agent_id)) ? parseInt(agent_id) : null;
    const camp = campaign_id && /^\d+$/.test(String(campaign_id)) ? parseInt(campaign_id) : null;
    // ongoing break/idle (not yet written to the log) — added live when range includes today
    const liveBreak = includeLive ? "+ (CASE WHEN u.status='paused' THEN TIMESTAMPDIFF(SECOND,u.status_changed_at,NOW()) ELSE 0 END)" : "";
    const liveIdle  = includeLive ? "+ (CASE WHEN u.status='online' THEN TIMESTAMPDIFF(SECOND,u.status_changed_at,NOW()) ELSE 0 END)" : "";

    let joinWhere = '';
    let rowWhere = '';
    const params = [];
    params.push(from, to);   // first_login subquery
    params.push(from, to);   // break_sec subquery
    params.push(from, to);   // idle_sec subquery
    params.push(from, to);   // main calls join
    if (aid)  { joinWhere += ' AND c.agent_id = ?'; params.push(aid); }
    if (camp) { joinWhere += ' AND c.campaign_id = ?'; params.push(camp); }
    if (aid)  { rowWhere = ' AND u.id = ?'; params.push(aid); }   // show ONLY the selected agent's row
    const sAgent = accountClause(req, 'u');   // tenant scope on users
    params.push(...sAgent.params);

    const report = await query(
      `SELECT u.id, u.full_name, u.extension, u.status,
       COUNT(c.id) as total_calls,
       SUM(CASE WHEN c.status = 'answered' THEN 1 ELSE 0 END) as answered,
       SUM(CASE WHEN d.is_sale = 1 THEN 1 ELSE 0 END) as sales,
       ROUND(AVG(CASE WHEN c.status = 'answered' THEN c.duration ELSE NULL END)) as avg_duration,
       SUM(c.duration) as total_talk_time,
       (SELECT MIN(s.logged_in_at) FROM agent_sessions s WHERE s.agent_id = u.id AND DATE(s.logged_in_at) BETWEEN ? AND ?) as first_login,
       (IFNULL((SELECT SUM(l.duration_sec) FROM agent_status_log l WHERE l.agent_id = u.id AND l.status='paused' AND DATE(l.ended_at) BETWEEN ? AND ?),0) ${liveBreak}) as break_sec,
       (IFNULL((SELECT SUM(l.duration_sec) FROM agent_status_log l WHERE l.agent_id = u.id AND l.status='online' AND DATE(l.ended_at) BETWEEN ? AND ?),0) ${liveIdle}) as idle_sec
       FROM users u
       LEFT JOIN calls c ON c.agent_id = u.id AND DATE(c.called_at) BETWEEN ? AND ? ${joinWhere}
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       WHERE u.role IN ('agent','supervisor') AND u.active = 1 ${rowWhere}${sAgent.clause}
       GROUP BY u.id ORDER BY total_calls DESC`,
      params
    );
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agent's OWN today stats — agent-accessible (only `authenticate`, no admin role),
// always scoped to the logged-in user (req.user.id), so an agent can only ever see
// their own numbers. Powers the agent "Performance Today" panel. The old /agent
// endpoint is admin-only, which is why the panel was stuck at 0 (403 for agents).
router.get('/my-performance', authenticate, async (req, res) => {
  try {
    const agentId = req.user.id;
    const from = req.query.date_from || new Date().toISOString().split('T')[0];
    const to   = req.query.date_to   || from;
    const row = await queryOne(
      `SELECT COUNT(c.id) AS total_calls,
              SUM(CASE WHEN c.status='answered' THEN 1 ELSE 0 END) AS answered,
              SUM(CASE WHEN d.is_sale=1 THEN 1 ELSE 0 END) AS sales,
              ROUND(AVG(CASE WHEN c.status='answered' THEN c.duration ELSE NULL END)) AS avg_duration,
              COALESCE(SUM(c.duration),0) AS total_talk_time
       FROM calls c LEFT JOIN dispositions d ON d.id = c.disposition_id
       WHERE c.agent_id = ? AND DATE(c.called_at) BETWEEN ? AND ?`,
      [agentId, from, to]
    );
    res.json(row || { total_calls: 0, answered: 0, sales: 0, avg_duration: 0, total_talk_time: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/campaign', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date().toISOString().split('T')[0];
    const to = date_to || from;

    const scCamp = accountClause(req, 'ca');
    const scCampWhere = scCamp.clause ? 'WHERE ' + scCamp.clause.replace(/^ AND /, '') : '';
    const report = await query(
      `SELECT ca.id, ca.name, ca.status, ca.dial_method,
       COUNT(c.id) as total_calls,
       SUM(CASE WHEN c.status = 'answered' THEN 1 ELSE 0 END) as answered,
       SUM(CASE WHEN d.is_sale = 1 THEN 1 ELSE 0 END) as sales,
       ROUND(AVG(CASE WHEN c.status = 'answered' THEN c.duration ELSE NULL END)) as avg_duration,
       (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = ca.id) as total_leads,
       (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = ca.id AND l.status = 'new') as remaining_leads
       FROM campaigns ca
       LEFT JOIN calls c ON c.campaign_id = ca.id AND DATE(c.called_at) BETWEEN ? AND ?
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       ${scCampWhere}
       GROUP BY ca.id ORDER BY total_calls DESC`,
      [from, to, ...scCamp.params]
    );
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/calls', authenticate, requireRole('admin', 'supervisor'), async (req, res) => {
  try {
    const { date_from, date_to, campaign_id, agent_id, page = 1, limit = 100 } = req.query;
    const from = date_from || new Date().toISOString().split('T')[0];
    const to = date_to || from;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = ['DATE(c.called_at) BETWEEN ? AND ?'];
    const params = [from, to];

    if (campaign_id) { where.push('c.campaign_id = ?'); params.push(campaign_id); }
    if (agent_id) { where.push('c.agent_id = ?'); params.push(agent_id); }
    const scCalls = campaignClause(req, 'c');
    if (scCalls.clause) { where.push(scCalls.clause.replace(/^ AND /, '')); params.push(...scCalls.params); }

    const calls = await query(
      `SELECT c.*, u.full_name as agent_name, ca.name as campaign_name,
       d.label as disposition_label, d.color as disposition_color,
       l.first_name, l.last_name, l.phone as lead_phone
       FROM calls c
       LEFT JOIN users u ON u.id = c.agent_id
       LEFT JOIN campaigns ca ON ca.id = c.campaign_id
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       LEFT JOIN leads l ON l.id = c.lead_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.called_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
