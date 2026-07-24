const net = require('net');
const { EventEmitter } = require('events');

let amiInstance = null;
let ioInstance = null;
let socketServiceInstance = null;

class AMIClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.buffer = '';
    this._greetingDone = false;
    this.actionCallbacks = new Map();
    this.reconnectTimer = null;
    this.reconnectDelay = 3000;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('AMI connection timeout')), 10000);

      // Reset per-connection state so reconnects re-detect the greeting and
      // re-authenticate. Without this, _greetingDone stays true from the prior
      // connection, the greeting is never re-detected, _login() never fires,
      // and Asterisk drops the unauthenticated socket → endless reconnect loop.
      this._greetingDone = false;
      this.buffer = '';
      this.connected = false;
      this.authenticated = false;

      this.socket = new net.Socket();
      this.socket.setEncoding('utf8');
      this.socket.setKeepAlive(true, 10000);

      this.socket.on('data', (data) => this._handleData(data));

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log('[AMI] Connected to Asterisk AMI');
      });

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[AMI] Socket error:', err.message);
        this.connected = false;
        this.authenticated = false;
        this._scheduleReconnect();
        reject(err);
      });

      this.socket.on('close', () => {
        console.log('[AMI] Connection closed');
        this.connected = false;
        this.authenticated = false;
        this._scheduleReconnect();
      });

      this.once('greeting', async () => {
        try {
          await this._login();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.socket.connect(this.config.port, this.config.host);
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.log('[AMI] Attempting reconnect...');
      try {
        await this.connect();
      } catch (err) {
        console.error('[AMI] Reconnect failed:', err.message);
      }
    }, this.reconnectDelay);
  }

  _handleData(data) {
    this.buffer += data;

    // ── Greeting: Asterisk sends a single line, not a double-CRLF block ──
    // Must detect it before the normal split logic
    if (!this._greetingDone) {
      const nlIdx = this.buffer.indexOf('\r\n');
      if (nlIdx !== -1) {
        const firstLine = this.buffer.substring(0, nlIdx).trim();
        if (firstLine.startsWith('Asterisk Call Manager')) {
          this._greetingDone = true;
          this.buffer = this.buffer.substring(nlIdx + 2);
          this.emit('greeting', firstLine);
          return;
        }
      }
      // Not a greeting yet — keep buffering
      if (!this.buffer.includes('\r\n\r\n')) return;
    }

    const messages = this.buffer.split('\r\n\r\n');
    this.buffer = messages.pop();

    for (const msg of messages) {
      if (!msg.trim()) continue;

      // Legacy greeting check (fallback)
      if (msg.startsWith('Asterisk Call Manager')) {
        this.emit('greeting', msg);
        continue;
      }

      const parsed = this._parseMessage(msg);
      if (!parsed) continue;

      if (parsed.Response && parsed.ActionID && this.actionCallbacks.has(parsed.ActionID)) {
        const { resolve, reject } = this.actionCallbacks.get(parsed.ActionID);
        this.actionCallbacks.delete(parsed.ActionID);
        if (parsed.Response === 'Success') {
          resolve(parsed);
        } else {
          reject(new Error(parsed.Message || parsed.Response));
        }
        continue;
      }

      if (parsed.Event) {
        this.emit('event', parsed);
        this.emit(parsed.Event, parsed);
      }
    }
  }

  _parseMessage(msg) {
    const obj = {};
    const lines = msg.split('\r\n');
    for (const line of lines) {
      const idx = line.indexOf(': ');
      if (idx === -1) continue;
      const key = line.substring(0, idx).trim();
      const val = line.substring(idx + 2).trim();
      obj[key] = val;
    }
    return Object.keys(obj).length ? obj : null;
  }

  _login() {
    return this.action({
      Action: 'Login',
      Username: this.config.username,
      Secret: this.config.secret,
      Events: 'on'
    }).then(() => {
      this.authenticated = true;
      console.log('[AMI] Authenticated successfully');
    });
  }

  action(params) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        return reject(new Error('AMI not connected'));
      }

      const actionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      params.ActionID = actionId;

      let msg = '';
      for (const [key, val] of Object.entries(params)) {
        msg += `${key}: ${val}\r\n`;
      }
      msg += '\r\n';

      this.actionCallbacks.set(actionId, { resolve, reject });

      setTimeout(() => {
        if (this.actionCallbacks.has(actionId)) {
          this.actionCallbacks.delete(actionId);
          reject(new Error('Action timeout'));
        }
      }, 15000);

      this.socket.write(msg);
    });
  }

  async originate(options) {
    const { channel, exten, context, callerid, timeout, variable, async: asyncFlag, account } = options;
    return this.action({
      Action: 'Originate',
      Channel: channel,
      Exten: exten,
      Context: context || 'from-internal',
      Priority: '1',
      CallerID: callerid || 'Dialer <Unknown>',
      Timeout: timeout || 30000,
      Variable: variable || '',
      Async: asyncFlag !== false ? 'true' : 'false',
      Account: account || ''
    });
  }

  async hangup(channel) {
    return this.action({ Action: 'Hangup', Channel: channel });
  }

  async transfer(channel, exten, context) {
    return this.action({
      Action: 'Redirect',
      Channel: channel,
      Exten: exten,
      Context: context || 'from-internal',
      Priority: '1'
    });
  }

  async park(channel, announceChannel) {
    return this.action({
      Action: 'Park',
      Channel: channel,
      AnnounceChannel: announceChannel || channel
    });
  }

  async setVar(channel, variable, value) {
    return this.action({ Action: 'Setvar', Channel: channel, Variable: variable, Value: value });
  }

  async playDTMF(channel, digit) {
    return this.action({ Action: 'PlayDTMF', Channel: channel, Digit: digit });
  }

  async monitor(channel, file, format) {
    return this.action({
      Action: 'Monitor',
      Channel: channel,
      File: file,
      Format: format || 'wav',
      Mix: 'true'
    });
  }

  async spyChannel(spyChannel, targetChannel, options) {
    return this.action({
      Action: 'ChanSpy',
      Channel: spyChannel,
      SpyChannel: targetChannel,
      Spy: options || 'q'
    });
  }

  async getChannels() {
    return this.action({ Action: 'CoreShowChannels' });
  }

  async queuesummary(queue) {
    return this.action({ Action: 'QueueSummary', Queue: queue || '' });
  }

  isReady() {
    return this.connected && this.authenticated;
  }
}

async function initAMI(io, socketService) {
  ioInstance = io;
  socketServiceInstance = socketService;

  const config = {
    host: process.env.AMI_HOST || '127.0.0.1',
    port: parseInt(process.env.AMI_PORT) || 5038,
    username: process.env.AMI_USER || 'dialer',
    secret: process.env.AMI_SECRET || 'changeme'
  };

  const ami = new AMIClient(config);
  amiInstance = ami;

  ami.on('event', (event) => {
    handleAMIEvent(event, io, socketService);
  });

  try {
    await ami.connect();
    console.log('[AMI] Ready');
  } catch (err) {
    console.warn('[AMI] Initial connection failed, will retry:', err.message);
  }

  return ami;
}

const { query } = require('../db/connection');

// ── Carrier congestion monitor ───────────────────────────────────────────────
// The trunk rejecting outbound calls (SIP 503 → DialStatus CONGESTION) is the
// real signal that we're hitting the carrier's concurrent-channel limit. We keep
// a 60s rolling count; once it crosses the threshold we push a 'trunk:congestion'
// alert to the admin UI, and auto-clear it after 30s of quiet.
let _congTimes = [];
let _congActive = false;
let _congClearTimer = null;
function recordCongestion(io) {
  const now = Date.now();
  _congTimes.push(now);
  _congTimes = _congTimes.filter(t => now - t < 60000);
  const count = _congTimes.length;
  const THRESHOLD = 5; // ≥5 carrier rejections within 60s = congestion
  if (count >= THRESHOLD) {
    if (!_congActive) console.warn(`[Trunk] CONGESTION — ${count} carrier rejections in last 60s`);
    _congActive = true;
    if (io) io.to('admins').emit('trunk:congestion', { active: true, count, ts: now });
    if (_congClearTimer) clearTimeout(_congClearTimer);
    _congClearTimer = setTimeout(() => {
      _congActive = false; _congTimes = [];
      if (io) io.to('admins').emit('trunk:congestion', { active: false });
      console.log('[Trunk] Congestion cleared');
    }, 30000);
  }
}

async function handleAMIEvent(event, io, socketService) {
  try {
    switch (event.Event) {
      case 'Hangup': {
        if (!event.Channel) break;
        // AMI sends Local/phone@ctx-UNIQUEID;2, DB stores Local/phone@ctx
        const channelBase = event.Channel
          .replace(/;[12]$/, '')         // strip ;1 or ;2
          .replace(/-[0-9a-f]+$/i, ''); // strip Asterisk unique hex ID suffix
        const call = await query(
          'SELECT * FROM calls WHERE channel = ? AND hung_up_at IS NULL ORDER BY called_at DESC LIMIT 1',
          [channelBase]
        );
        if (call[0]) {
          try { require('./dialerEngine').clearLeadChannel(call[0].id); } catch (_) {}
          const duration = call[0].answered_at
            ? Math.floor((Date.now() - new Date(call[0].answered_at).getTime()) / 1000)
            : 0;
          await query(
            'UPDATE calls SET hung_up_at = NOW(), duration = ?, status = CASE WHEN status = "answered" THEN "answered" ELSE "no_answer" END WHERE id = ?',
            [duration, call[0].id]
          );
          if (call[0].agent_id) {
            // Customer leg ended — but do NOT free the agent yet. If we flip them
            // to 'available' here, the predictive dialer immediately dispatches the
            // next lead before the agent has dispositioned this one, which churns
            // the agent's call state (button strobing, leads piling up, no chance
            // to dispose). Keep them 'oncall' (wrap-up) until they submit a
            // disposition (which sets 'available'); the stuck-call reaper frees
            // them automatically if they vanish without disposing.
            if (socketService) {
              socketService.broadcastToAgent(call[0].agent_id, 'call:hangup', {
                call_id: call[0].id,
                duration,
                needs_disposition: true
              });
            }
          }
          if (io) {
            io.to('admins').emit('call:hangup', { call_id: call[0].id, channel: event.Channel, duration });
          }
        }
        break;
      }

      case 'DialBegin': {
        if (io) {
          io.to('admins').emit('call:ringing', {
            channel: event.Channel,
            dest_channel: event.DestChannel,
            caller_id: event.CallerIDNum
          });
        }
        break;
      }

      case 'DialEnd': {
        const dialer = require('./dialerEngine');
        if (event.DialStatus === 'ANSWER' && event.Channel) {
          const channelBase = event.Channel
            .replace(/;[12]$/, '')
            .replace(/-[0-9a-f]+$/i, '');
          const call = (await query(
            'SELECT * FROM calls WHERE channel = ? ORDER BY called_at DESC LIMIT 1',
            [channelBase]
          ))[0];
          if (!call) break;
          if (call.agent_id) {
            // Progressive — agent was pre-assigned. Mark answered & notify them.
            await query('UPDATE calls SET status = "answered", answered_at = NOW() WHERE id = ?', [call.id]);
            await query('UPDATE users SET status = "oncall" WHERE id = ?', [call.agent_id]);
            await query("UPDATE agent_sessions SET status = 'oncall' WHERE agent_id = ? AND logged_out_at IS NULL", [call.agent_id]);
            if (socketService) {
              socketService.broadcastToAgent(call.agent_id, 'call:answered', { call_id: call.id });
              socketService.broadcastAgentStatus(call.agent_id, 'oncall', {});
            }
            if (io) io.to('admins').emit('call:answered', { call_id: call.id, channel: event.Channel });
          }
          // Predictive: AMD in the lead-wait dialplan decides the outcome — a
          // LeadHuman UserEvent connects a live agent, a LeadMachine UserEvent
          // auto-disposes. Handled in the UserEvent case, nothing to do here.
        } else if (['NOANSWER', 'BUSY', 'CONGESTION', 'CANCEL', 'CHANUNAVAIL', 'ABORT'].includes(event.DialStatus) && event.Channel) {
          // Carrier congestion (503) = the trunk turning calls away → alert admins.
          if (event.DialStatus === 'CONGESTION') recordCongestion(io);
          // Predictive lead that never picked up → auto-dispose "no answer"
          await dialer.handleLeadNoAnswer(event.Channel, io);
        }
        break;
      }

      case 'UserEvent': {
        // AMD outcome signalled by the lead-wait dialplan. event.Channel is the
        // lead's holding ;1 leg; look the call up by its base channel (more
        // reliable than a channel variable, which may not reach this leg).
        if (event.UserEvent !== 'LeadHuman' && event.UserEvent !== 'LeadMachine') break;
        const dialer = require('./dialerEngine');
        const base = (event.Channel || '').replace(/;[12]$/, '').replace(/-[0-9a-f]+$/i, '');
        if (!base) break;
        const call = (await query(
          "SELECT * FROM calls WHERE channel = ? AND hung_up_at IS NULL ORDER BY called_at DESC LIMIT 1",
          [base]
        ))[0];
        if (!call) break;
        if (event.UserEvent === 'LeadHuman') {
          await dialer.handleLeadHuman(call, event.Channel, getAMI(), io, socketService);
        } else {
          await dialer.handleLeadMachine(call, io);
        }
        break;
      }

      case 'AgentConnect':
      case 'AgentCalled': {
        if (io) {
          io.to('admins').emit('queue:agent_event', event);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[AMI] Event handler error:', err.message);
  }
}

function getAMI() {
  return amiInstance;
}

module.exports = { initAMI, getAMI };
