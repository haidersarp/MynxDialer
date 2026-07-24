const jwt = require('jsonwebtoken');
const { query } = require('../db/connection');

let socketServiceInstance = null;

class SocketService {
  constructor(io) {
    this.io = io;
    this.agentSockets = new Map();    // agentId -> Set of socket ids
    this.socketAgents = new Map();    // socketId -> agentId
    this.disconnectTimers = new Map(); // agentId -> timeout — debounce offline status
    this._init();
    this._resetStalePresence();
  }

  // On startup the in-memory presence maps are empty, so any agent still flagged
  // online/available/paused is STALE — its disconnect timer was lost when the
  // backend last restarted (e.g. a deploy). Reset those to offline; genuinely
  // connected agents re-register within seconds. 'oncall' is preserved because
  // the live Asterisk call survives a backend restart.
  async _resetStalePresence() {
    try {
      const r = await query("UPDATE users SET status = 'offline' WHERE role = 'agent' AND status NOT IN ('offline','oncall')");
      if (r?.affectedRows) console.log(`[Socket] Reset ${r.affectedRows} stale agent(s) to offline on startup`);
    } catch (e) { console.warn('[Socket] presence reset skipped:', e.message); }
  }

  _init() {
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme');
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
      } catch (err) {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      const role = socket.userRole;

      // ── multi-tenant: resolve this socket's account once (cached). Fail-open on
      // the join path so a DB hiccup never blocks an agent from dialing. ──
      let _acct = undefined;
      const acct = async () => {
        if (_acct !== undefined) return _acct;
        try {
          const r = await query('SELECT account_id, role FROM users WHERE id = ?', [userId]);
          _acct = r[0] ? { accountId: r[0].account_id, role: r[0].role } : null;
        } catch (_) { _acct = null; }
        return _acct;
      };

      // Cancel any pending offline timer — agent reconnected before the grace period expired
      if (this.disconnectTimers.has(userId)) {
        clearTimeout(this.disconnectTimers.get(userId));
        this.disconnectTimers.delete(userId);
      }

      if (!this.agentSockets.has(userId)) {
        this.agentSockets.set(userId, new Set());
      }
      this.agentSockets.get(userId).add(socket.id);
      this.socketAgents.set(socket.id, userId);

      if (['admin', 'supervisor'].includes(role)) {
        socket.join('admins');
      }
      socket.join(`user:${userId}`);
      // multi-tenant: account-scoped rooms so chat/announcements never cross accounts
      acct().then(a => {
        if (a && a.accountId != null) {
          socket.join(`acct:${a.accountId}`);
          if (['admin', 'supervisor'].includes(role)) socket.join(`acctadmins:${a.accountId}`);
        }
      }).catch(() => {});

      console.log(`[Socket] User ${userId} (${role}) connected: ${socket.id}`);

      // ── Self-heal presence on (re)connect ──────────────────────────────────
      // A backend restart (_resetStalePresence) or a brief socket drop leaves
      // user.status stale (offline/online) while the agent is really still here
      // with an active session — so the dialer skips them (uncallable) even
      // though their conference audio is up. They'd otherwise have to log out/in.
      // Restore user.status FROM the persisted session (the source of truth) a
      // few seconds after connect, so it wins over any 'online' the client may
      // re-assert on reconnect. Never override a live 'oncall'.
      if (role === 'agent') {
        setTimeout(async () => {
          try {
            const socks = this.agentSockets.get(userId);
            if (!socks || socks.size === 0) return; // dropped again
            const rows = await query(
              "SELECT status FROM agent_sessions WHERE agent_id = ? AND logged_out_at IS NULL ORDER BY id DESC LIMIT 1",
              [userId]
            );
            const sess = rows && rows[0];
            if (!sess || !['available', 'paused'].includes(sess.status)) return;
            const urows = await query("SELECT status FROM users WHERE id = ?", [userId]);
            const cur = urows && urows[0] && urows[0].status;
            if (cur === 'oncall' || cur === sess.status) return;
            await query("UPDATE users SET status = ? WHERE id = ? AND status <> 'oncall'", [sess.status, userId]);
            this.broadcastAgentStatus(userId, sess.status, {});
            console.log(`[Socket] Restored agent ${userId} presence -> ${sess.status} after reconnect`);
          } catch (_) {}
        }, 3000);
      }

      socket.on('agent:join-campaign', async (data) => {
        const { campaign_id } = data;
        const a = await acct();
        if (a && a.role !== 'super_admin') {
          const own = await query('SELECT id FROM campaigns WHERE id = ? AND account_id = ?', [campaign_id, a.accountId]).catch(() => null);
          if (own && !own.length) { console.warn(`[Socket] join-campaign denied: user ${userId} campaign ${campaign_id}`); return; }
        }
        socket.join(`campaign:${campaign_id}`);
        await query(
          'INSERT INTO agent_sessions (agent_id, campaign_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE campaign_id=?, logged_out_at=NULL, status=?',
          [userId, campaign_id, 'available', campaign_id, 'available']
        ).catch(() => {});
      });

      socket.on('agent:status', async (data) => {
        const { status, pause_code_id } = data;
        await query('UPDATE users SET status = ? WHERE id = ?', [status, userId]).catch(() => {});
        this.broadcastAgentStatus(userId, status, { pause_code_id });
      });

      socket.on('admin:barge', async (data) => {
        const { agent_id } = data;
        const a = await acct();
        if (a && a.role !== 'super_admin') {
          const own = await query('SELECT id FROM users WHERE id = ? AND account_id = ?', [agent_id, a.accountId]).catch(() => []);
          if (!own.length) return socket.emit('error', { message: 'Not permitted' });
        }
        const { getAMI } = require('./amiClient');
        const ami = getAMI();
        if (!ami) return socket.emit('error', { message: 'AMI not connected' });

        const activeCalls = await query(
          'SELECT * FROM calls WHERE agent_id = ? AND hung_up_at IS NULL AND status = "answered"',
          [agent_id]
        ).catch(() => []);

        if (activeCalls[0] && activeCalls[0].channel) {
          await ami.spyChannel(socket.id, activeCalls[0].channel, 'q').catch(console.error);
        }
      });

      // ── Internal team chat ────────────────────────────────────────────────
      // Plain text over this existing socket. Persist to `messages`, then deliver
      // live: team/broadcast → everyone; dm → the two participants only. Never
      // touches calls/Asterisk. Only admin/supervisor may post to 'broadcast'.
      socket.on('chat:send', async (data) => {
        try {
          const isAdmin = ['admin', 'supervisor'].includes(role);
          let { channel, recipient_id, campaign_id, body, priority, attachment } = data || {};
          body = (body == null ? '' : String(body)).trim().slice(0, 2000);
          const att = attachment && attachment.url ? attachment : null;
          if (!body && !att) return;   // need text OR an attachment
          channel = ['broadcast', 'campaign', 'dm', 'team'].includes(channel) ? channel : 'broadcast';
          // Only admins/supervisors may post to Announce (broadcast) or flag priority.
          if (channel === 'broadcast' && !isAdmin) channel = 'campaign';
          const prio = (priority && isAdmin) ? 1 : 0;
          recipient_id = channel === 'dm' ? (parseInt(recipient_id) || null) : null;
          campaign_id  = channel === 'campaign' ? (parseInt(campaign_id) || null) : null;
          if (channel === 'dm' && !recipient_id) return;
          if (channel === 'campaign' && !campaign_id) return;

          const _a = await acct();
          const senderAccountId = _a ? _a.accountId : null;
          const result = await query(
            'INSERT INTO messages (channel, account_id, sender_id, recipient_id, campaign_id, body, priority, attachment_url, attachment_name, attachment_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [channel, senderAccountId, userId, recipient_id, campaign_id, body, prio, att?.url || null, att?.name || null, att?.type || null]
          );
          const urows = await query('SELECT username, full_name, role FROM users WHERE id = ?', [userId]);
          const u = (urows && urows[0]) || {};
          const msg = {
            id: result.insertId,
            channel,
            account_id: senderAccountId,
            sender_id: userId,
            recipient_id,
            campaign_id,
            sender_name: u.full_name || u.username || `User ${userId}`,
            sender_role: u.role,
            body,
            priority: prio,
            attachment_url: att?.url || null,
            attachment_name: att?.name || null,
            attachment_type: att?.type || null,
            created_at: new Date().toISOString()
          };
          if (channel === 'dm') {
            this.io.to(`user:${recipient_id}`).emit('chat:message', msg);
            this.io.to(`user:${userId}`).emit('chat:message', msg);
          } else if (channel === 'campaign') {
            this.io.to(`campaign:${campaign_id}`).emit('chat:message', msg);           // that campaign's agents
            if (senderAccountId != null) this.io.to(`acctadmins:${senderAccountId}`).emit('chat:message', msg); // only THIS account's admins
            else this.io.to('admins').emit('chat:message', msg);
          } else {
            // broadcast/team → everyone in THIS account only (never cross-account)
            if (senderAccountId != null) this.io.to(`acct:${senderAccountId}`).emit('chat:message', msg);
            else this.io.to(`user:${userId}`).emit('chat:message', msg);
          }
        } catch (e) {
          console.error('[Chat] send error:', e.message);
        }
      });

      socket.on('disconnect', async () => {
        const sockets = this.agentSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            // Wait 5 seconds before marking offline — allows browser refreshes and
            // brief WebSocket drops to reconnect without interrupting the dialer.
            const timer = setTimeout(async () => {
              this.disconnectTimers.delete(userId);
              const current = this.agentSockets.get(userId);
              if (current && current.size > 0) return; // reconnected in time
              this.agentSockets.delete(userId);
              await query(
                'UPDATE users SET status = "offline" WHERE id = ? AND status != "offline"',
                [userId]
              ).catch(() => {});
              await query(
                'UPDATE agent_sessions SET logged_out_at = NOW() WHERE agent_id = ? AND logged_out_at IS NULL',
                [userId]
              ).catch(() => {});
              this.broadcastAgentStatus(userId, 'offline', {});
            }, 5000);
            this.disconnectTimers.set(userId, timer);
          }
        }
        this.socketAgents.delete(socket.id);
        console.log(`[Socket] User ${userId} disconnected: ${socket.id}`);
      });
    });
  }

  broadcastAgentStatus(agentId, status, meta = {}) {
    this.io.to('admins').emit('agent:status', {
      agent_id: agentId,
      status,
      ...meta,
      timestamp: Date.now()
    });
  }

  broadcastToAgent(agentId, event, data) {
    this.io.to(`user:${agentId}`).emit(event, data);
  }

  broadcastToAll(event, data) {
    this.io.emit(event, data);
  }

  broadcastToAdmins(event, data) {
    this.io.to('admins').emit(event, data);
  }

  getConnectedAgents() {
    return Array.from(this.agentSockets.keys());
  }

  isAgentConnected(agentId) {
    const sockets = this.agentSockets.get(agentId);
    return sockets && sockets.size > 0;
  }

  // ── Trainee shadowing (purely additive; touches nothing on the call path) ──
  // Deliberately NOT hooked into the dialer's call:answered emit path — the
  // trainee panel polls /api/trainee/agents/:id/context instead. Tracking who
  // is shadowing whom is bookkeeping for admin visibility only; if any of this
  // throws it must never affect a call, hence the lazy map init and no awaits.
  traineeWatch(traineeId, agentId) {
    if (!this._traineeWatch) this._traineeWatch = new Map();
    this._traineeWatch.set(traineeId, { agentId, since: Date.now() });
  }

  traineeUnwatch(traineeId) {
    if (this._traineeWatch) this._traineeWatch.delete(traineeId);
  }

  // [{ trainee_id, agent_id, since }] — for an admin "who is shadowing" view.
  getTraineeWatchers() {
    if (!this._traineeWatch) return [];
    return Array.from(this._traineeWatch.entries())
      .map(([trainee_id, v]) => ({ trainee_id, agent_id: v.agentId, since: v.since }));
  }
}

function initSocketService(io) {
  socketServiceInstance = new SocketService(io);
  return socketServiceInstance;
}

function getSocketService() {
  return socketServiceInstance;
}

module.exports = { initSocketService, getSocketService };
