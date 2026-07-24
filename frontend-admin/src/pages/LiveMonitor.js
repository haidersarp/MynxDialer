import React, { useState, useEffect, useCallback, useRef } from 'react';
import { agentsAPI, callsAPI, adminAPI } from '../services/api';
import { initSIP, makeCall, hangup, attachRemoteAudio, stopSIP, initKeepAlive } from '../services/sipClient';

import { getSocket } from '../services/socket';

// Mode → ChanSpy feature-code prefix (dialed by the admin's own WebRTC line).
const MODE_PREFIX = { listen: '*55', whisper: '*56', barge: '*57' };

const MONITOR_MODES = [
  { mode: 'listen',  label: 'Listen (Silent)',     icon: '👁',  desc: 'You hear both sides — stay muted',   color: '#2979ff' },
  { mode: 'whisper', label: 'Whisper (Agent Only)', icon: '👂', desc: 'You speak to agent only',            color: '#ff9100' },
  { mode: 'barge',   label: 'Barge (Both Hear)',    icon: '🎙', desc: 'Full join — everyone hears you',     color: '#ff5252' },
];

function useCallTimer(start) {
  const [e, setE] = useState(0);
  useEffect(() => {
    if (!start) { setE(0); return; }
    setE(Math.floor((Date.now() - new Date(start).getTime()) / 1000));
    const iv = setInterval(() => setE(Math.floor((Date.now() - new Date(start).getTime()) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [start]);
  const m = Math.floor(e / 60), s = e % 60;
  return e > 0 ? `${m}:${s.toString().padStart(2, '0')}` : null;
}

// ── Per-agent monitor dropdown ──────────────────────────────────────────────
function MonitorControl({ agent, onMonitor, activeMode, onStop }) {
  const [open, setOpen]       = useState(false);
  const [selected, setSelected] = useState('listen');
  const ref = useRef();
  const isOnCall = agent.status === 'oncall';

  useEffect(() => {
    const fn = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const currentMode = MONITOR_MODES.find(m => m.mode === (activeMode || selected));

  const handleGo = () => {
    if (!isOnCall) return;
    onMonitor(agent.id, selected);
  };

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {/* Main row: dropdown selector + GO / STOP button */}
      <div style={{ display: 'flex', gap: 4 }}>
        {/* Dropdown selector */}
        <div
          onClick={() => setOpen(!open)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: '4px 0 0 4px', cursor: 'pointer',
            background: activeMode
              ? `${currentMode.color}18`
              : 'var(--bg-tertiary)',
            border: `1px solid ${activeMode ? currentMode.color + '55' : 'var(--border)'}`,
            borderRight: 'none',
            transition: 'all 0.15s',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13 }}>{currentMode.icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: activeMode ? currentMode.color : 'var(--text-secondary)' }}>
              {activeMode ? currentMode.label : currentMode.label}
            </span>
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>▼</span>
        </div>

        {/* Action button */}
        {activeMode ? (
          <button
            onClick={onStop}
            style={{
              padding: '6px 12px', borderRadius: '0 4px 4px 0', cursor: 'pointer',
              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
              background: 'rgba(255,82,82,0.15)', border: '1px solid rgba(255,82,82,0.4)',
              color: 'var(--danger)', whiteSpace: 'nowrap',
            }}>
            ✕ STOP
          </button>
        ) : (
          <button
            onClick={handleGo}
            disabled={!isOnCall}
            style={{
              padding: '6px 14px', borderRadius: '0 4px 4px 0', cursor: isOnCall ? 'pointer' : 'not-allowed',
              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
              background: isOnCall ? `${currentMode.color}22` : 'var(--bg-input)',
              border: `1px solid ${isOnCall ? currentMode.color + '55' : 'var(--border-dim)'}`,
              color: isOnCall ? currentMode.color : 'var(--text-muted)',
              whiteSpace: 'nowrap', opacity: isOnCall ? 1 : 0.5,
            }}>
            GO
          </button>
        )}
      </div>

      {/* Active monitor pulse banner */}
      {activeMode && (
        <div style={{
          marginTop: 5, padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center',
          background: `${currentMode.color}18`, border: `1px solid ${currentMode.color}44`,
          color: currentMode.color, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ animation: 'blink 1s infinite' }}>●</span>
          MONITORING ACTIVE — {currentMode.label.toUpperCase()}
        </div>
      )}

      {/* Dropdown menu */}
      {open && (
        <div style={{
          position: 'absolute', bottom: '110%', left: 0, right: 0, zIndex: 600,
          background: 'linear-gradient(160deg, #0f1e38, #0b1628)',
          border: '1px solid rgba(0,229,255,0.2)', borderRadius: 8,
          boxShadow: '0 -20px 60px rgba(0,0,0,0.7), 0 0 30px rgba(0,229,255,0.05)',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '8px 12px', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Select Monitor Mode</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 9 }}>Requires active call</span>
          </div>
          {MONITOR_MODES.map((m, i) => (
            <div
              key={m.mode}
              onClick={() => { setSelected(m.mode); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 14px',
                cursor: 'pointer', transition: 'background 0.15s',
                background: selected === m.mode ? `${m.color}12` : 'transparent',
                borderBottom: i < MONITOR_MODES.length - 1 ? '1px solid var(--border-dim)' : 'none',
              }}
              onMouseEnter={e => { if (selected !== m.mode) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (selected !== m.mode) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 20, flexShrink: 0, width: 26, textAlign: 'center' }}>{m.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: m.color }}>{m.label}</span>
                  {selected === m.mode && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: `${m.color}22`, color: m.color, fontWeight: 800, border: `1px solid ${m.color}44` }}>SELECTED</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{m.desc}</div>
              </div>
            </div>
          ))}
          <div style={{ padding: '8px 14px', background: 'rgba(0,0,0,0.2)', fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span>💡</span>
            <span>Audio routed to your configured SIP extension via Asterisk ChanSpy</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agent card ──────────────────────────────────────────────────────────────
function AgentCard({ agent, onMonitor, onHangup, onForceLogout, monitorMode, onStopMonitor }) {
  const duration = useCallTimer(agent.answered_at);
  const isOnCall  = agent.status === 'oncall';
  const isAvail   = agent.status === 'available';
  const isPaused  = agent.status === 'paused';
  const sc = { available: '#00e676', oncall: '#ff5252', paused: '#ff9100', wrapup: '#e040fb', offline: '#253a55' }[agent.status] || '#253a55';

  // Live "how long in current state" timer (oncall uses the call Duration field;
  // offline shows nothing). available=Waiting, paused=On break, online=Idle.
  const showStateTimer = ['available', 'paused', 'online'].includes(agent.status);
  const stateTime  = useCallTimer(showStateTimer ? agent.status_changed_at : null);
  const stateLabel = agent.status === 'available' ? 'Waiting'
                   : agent.status === 'paused'    ? 'On break'
                   : agent.status === 'online'    ? 'Idle' : '';

  return (
    <div className={`agent-card ${agent.status || 'offline'}`}>
      {/* Header: avatar + name + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${sc}33, ${sc}11)`,
            border: `2px solid ${sc}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 17, fontWeight: 800, color: sc,
            boxShadow: isOnCall ? `0 0 14px ${sc}55` : 'none',
          }}>
            {(agent.full_name || agent.username || 'A')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {agent.full_name || agent.username}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
              EXT {agent.extension || '—'}
              {agent.campaign_name && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>· {agent.campaign_name}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span className={`badge badge-${agent.status || 'offline'}`}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', boxShadow: isOnCall ? '0 0 8px currentColor' : 'none' }} />
            {(agent.status || 'OFFLINE').toUpperCase()}
            {isPaused && agent.pause_label && ` · ${agent.pause_label}`}
          </span>
          {showStateTimer && stateTime && (
            <span style={{ fontSize: 10.5, fontWeight: 800, fontFamily: 'var(--font-mono)', color: sc, whiteSpace: 'nowrap' }}>
              ⏱ {stateLabel} {stateTime}
            </span>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 12 }}>
        {[
          { label: 'Duration', value: isOnCall && duration ? duration : '—', color: isOnCall ? '#ff5252' : undefined, mono: true },
          { label: 'Caller ID', value: agent.caller_id ? agent.caller_id.slice(-10) : '—', mono: true },
          { label: 'Logged In', value: agent.logged_in_at ? new Date(agent.logged_in_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—' },
        ].map(f => (
          <div key={f.label} style={{ padding: '6px 8px', background: 'var(--bg-input)', borderRadius: 4, border: '1px solid var(--border-dim)', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{f.label}</div>
            <div style={{ fontSize: f.mono ? 12 : 11, fontWeight: 600, fontFamily: f.mono ? 'var(--font-mono)' : undefined, color: f.color || 'var(--text-primary)' }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* Monitor control — always visible */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 5 }}>
          Call Monitoring {!isOnCall && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(available when agent is on call)</span>}
        </div>
        <MonitorControl
          agent={agent}
          onMonitor={onMonitor}
          activeMode={monitorMode}
          onStop={() => onStopMonitor(agent.id)}
        />
      </div>

      {/* Action buttons */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {isOnCall && (
          <button onClick={() => onHangup(agent.id)} style={{ flex:1, padding:'6px', borderRadius:100, cursor:'pointer', fontSize:11, fontWeight:700, textTransform:'uppercase', background:'rgba(255,82,82,0.08)', border:'1px solid rgba(255,82,82,0.25)', color:'var(--danger)', transition:'all 0.15s' }}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,82,82,0.18)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(255,82,82,0.08)'}>
            ✕ Hangup
          </button>
        )}
        <button onClick={() => onForceLogout(agent.id, agent.full_name || agent.username)}
          style={{ flex:1, padding:'6px', borderRadius:100, cursor:'pointer', fontSize:11, fontWeight:700, textTransform:'uppercase', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', color:'#b91c1c', transition:'all 0.15s' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.15)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,0.06)'}>
          ⏻ Force Logout
        </button>
      </div>

      {!isOnCall && !isAvail && !isPaused && (
        <div style={{ fontSize:11, color:'var(--text-secondary)', textAlign:'center', fontStyle:'italic', marginTop:4 }}>Agent is offline</div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function LiveMonitor() {
  const [agents, setAgents]         = useState([]);
  const [filter, setFilter]         = useState('all');
  const [search, setSearch]         = useState('');
  const [monitoring, setMonitoring] = useState({});   // { [agentId]: mode } — only one active at a time
  const [toast, setToast]           = useState(null);
  const [stats, setStats]           = useState({ total:0, available:0, oncall:0, paused:0, offline:0 });
  const [sipState, setSipState]     = useState('connecting'); // connecting | ready | error | unavailable
  const audioRef = useRef(null);
  const sipConfigRef = useRef(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Register the admin's own WebRTC line so we can ChanSpy agents ──────────
  // Audio is browser-INITIATED (we dial *55/*56/*57<ext>), which is the only
  // reliable WebRTC path here — the same reason agents join via *88.
  useEffect(() => {
    let mounted = true;
    adminAPI.sipConfig()
      .then(cfg => {
        if (!mounted) return;
        // When served from a real domain (your-domain.com), route the monitor
        // WebSocket through the SAME origin's /ws (valid Let's Encrypt cert via
        // nginx → Asterisk). The backend hands out the raw-IP WSS (self-signed
        // cert the admin browser never accepted) → monitor line hangs on
        // "connecting…". On the raw-IP setup, keep the backend ws_servers as-is.
        const h = window.location.hostname;
        if (window.location.protocol === 'https:' && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
          cfg = { ...cfg, ws_servers: `wss://${window.location.host}/ws` };
        }
        sipConfigRef.current = cfg;
        initSIP(cfg, {
          onRegistered:        () => mounted && setSipState('ready'),
          onRegistrationFailed: () => mounted && setSipState('error'),
          onUnregistered:      () => mounted && setSipState('connecting'),
          onRemoteStream:      (stream) => attachRemoteAudio(stream, audioRef.current),
          onCallEnded:         () => { if (mounted) setMonitoring({}); },
          onCallFailed:        () => { if (mounted) { setMonitoring({}); showToast('Monitor call failed', 'error'); } },
        });
      })
      .catch(() => mounted && setSipState('unavailable'));
    return () => { mounted = false; try { stopSIP(); } catch (_) {} };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await agentsAPI.live();
      setAgents(data || []);
      const s = { total: data.length, available:0, oncall:0, paused:0, offline:0 };
      data.forEach(a => { const k = ['available','oncall','paused'].includes(a.status) ? a.status : 'offline'; s[k]++; });
      setStats(s);
    } catch (err) { console.error(err); }
  }, []);

  // Coalesce refreshes: the 1s poll AND every agent:status/call:answered/call:hangup
  // socket event would each fire load(). During heavy dialing those arrive many
  // times per second — flooding the DB (MySQL CPU spike) and thrashing the admin
  // UI, which stalled things. Throttle so load() runs at most once per second
  // regardless of trigger volume (keeps the ~1s live feel, kills the flood).
  const loadTimer = useRef(null);
  const lastLoad  = useRef(0);
  const requestLoad = useCallback(() => {
    if (loadTimer.current) return; // a refresh is already queued
    const wait = Math.max(0, 1000 - (Date.now() - lastLoad.current));
    loadTimer.current = setTimeout(() => {
      loadTimer.current = null;
      lastLoad.current = Date.now();
      load();
    }, wait);
  }, [load]);

  useEffect(() => {
    load();
    const iv = setInterval(requestLoad, 1000);
    const socket = getSocket();
    socket.on('agent:status',  requestLoad);
    socket.on('call:answered', requestLoad);
    socket.on('call:hangup',   requestLoad);
    socket.on('monitor:started', d => {
      const m = MONITOR_MODES.find(x => x.mode === d.mode);
      showToast(`${m?.icon} ${m?.label} started — audio routing to your extension`, 'success');
    });
    return () => { clearInterval(iv); if (loadTimer.current) clearTimeout(loadTimer.current); ['agent:status','call:answered','call:hangup','monitor:started'].forEach(e => socket.off(e)); };
  }, [load, requestLoad]);

  const handleMonitor = async (agentId, mode) => {
    if (sipState !== 'ready') {
      showToast('Monitor line not ready yet — wait for "Monitor line ready"', 'error');
      return;
    }
    const agent = agents.find(a => a.id === agentId);
    if (!agent?.extension) { showToast('Agent has no SIP extension', 'error'); return; }

    initKeepAlive(); // user gesture — keeps tab + audio pipeline awake
    // Only one monitor at a time: drop any current spy first.
    hangup();
    const target = `${MODE_PREFIX[mode]}${agent.extension}`;
    try {
      makeCall(target, sipConfigRef.current);
      setMonitoring({ [agentId]: mode });
      callsAPI.monitor(agentId, mode).catch(() => {}); // best-effort broadcast/log
      const m = MONITOR_MODES.find(x => x.mode === mode);
      showToast(`${m.icon} ${m.label} on ${agent.full_name || agent.username} — connecting audio…`, 'success');
    } catch (err) {
      showToast('Could not start monitor: ' + (err.message || 'dial failed'), 'error');
    }
  };

  const handleStopMonitor = async (agentId) => {
    hangup();
    setMonitoring({});
    callsAPI.stopMonitor(agentId).catch(() => {});
    showToast('Monitoring stopped', 'info');
  };

  const handleForceLogout = async (agentId, agentName) => {
    if (!window.confirm(`Force logout ${agentName}? This will end their session immediately.`)) return;
    try {
      await agentsAPI.forceLogout(agentId);
      showToast(`${agentName} has been logged out`, 'info');
      load();
    } catch (err) { showToast(err.error || 'Force logout failed', 'error'); }
  };

  const handleHangup = async (agentId) => {
    if (!window.confirm('Force-hang up this agent\'s call?')) return;
    try {
      await callsAPI.hangup(agentId);
      showToast('Call terminated', 'info');
      load();
    } catch (err) { showToast(err.error || 'Hangup failed', 'error'); }
  };

  const ACTIVE = ['available', 'oncall', 'paused'];
  const filtered = agents.filter(a => {
    // "Offline" = anything NOT actively working (incl. idle 'online'), matching
    // the KPI count which buckets non-active statuses as offline. This keeps the
    // Offline tab and the "Offline (N)" count in agreement.
    const mf = filter === 'all'
      ? true
      : filter === 'active'   ? ACTIVE.includes(a.status)
      : filter === 'offline'  ? !ACTIVE.includes(a.status)
      : a.status === filter;
    const ms = !search || [a.full_name, a.username, a.extension, a.campaign_name].some(v => v?.toLowerCase().includes(search.toLowerCase()));
    return mf && ms;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display:'flex', alignItems:'center', gap:12 }}>
            <span style={{ width:10, height:10, borderRadius:'50%', background:'var(--danger)', boxShadow:'0 0 12px var(--danger)', display:'inline-block', animation:'pulse-red 2s infinite' }} />
            Live Monitor
          </h1>
          <p className="page-subtitle">Real-time agent activity — auto-refreshes every 1s</p>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <input className="input" style={{ width:220 }} placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:12, marginBottom:20 }}>
        {[
          { l:'Total Agents', v:stats.total,     g:'grad-3' },
          { l:'Available',    v:stats.available, g:'grad-1' },
          { l:'On Call',      v:stats.oncall,    g:'grad-0' },
          { l:'Paused',       v:stats.paused,    g:'grad-4' },
          { l:'Offline',      v:stats.offline,   g:'grad-2' },
        ].map(s => (
          <div key={s.l} className={`stat-card ${s.g}`} style={{ padding:16 }}>
            <div className="stat-label">{s.l}</div>
            <div className="stat-value" style={{ fontSize:32 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* How monitoring works banner + monitor-line status */}
      <div style={{ marginBottom:18, padding:'14px 18px', background:'linear-gradient(90deg,rgba(41,121,255,0.08),rgba(0,229,255,0.04))', border:'1px solid rgba(41,121,255,0.2)', borderRadius:'var(--radius-lg)', display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
        <div style={{ fontSize:20 }}>{'🎧'}</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:3, display:'flex', alignItems:'center', gap:10 }}>
            How Call Monitoring Works
            {/* Live monitor-line status */}
            {(() => {
              const map = {
                connecting:  { c:'var(--warning)', t:'Monitor line connecting…' },
                ready:       { c:'var(--success)', t:'● Monitor line ready' },
                error:       { c:'var(--danger)',  t:'Monitor line failed to register' },
                unavailable: { c:'var(--danger)',  t:'No SIP extension for your account' },
              }[sipState] || {};
              return <span style={{ fontSize:11, fontWeight:800, padding:'2px 10px', borderRadius:100, background:`${map.c}1a`, color:map.c, border:`1px solid ${map.c}44` }}>{map.t}</span>;
            })()}
          </div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.6 }}>
            Pick a mode on any agent that's <strong>on a call</strong>, then click GO — audio plays right here in your browser
            (your account's WebRTC line dials Asterisk ChanSpy). Whisper &amp; Barge use your mic, so allow microphone access. Click STOP to end.
          </div>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {MONITOR_MODES.map(m => (
            <div key={m.mode} style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 12px', borderRadius:4, background:m.color+'12', border:'1px solid '+m.color+'33' }}>
              <span>{m.icon}</span>
              <span style={{ fontSize:11, fontWeight:700, color:m.color }}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hidden audio sink for the monitor stream */}
      <audio ref={audioRef} autoPlay playsInline style={{ display:'none' }} />

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16 }}>
        {['all','active','available','oncall','paused','offline'].map(f => (
          <button key={f} className={`btn btn-sm ${filter===f?'btn-primary':'btn-secondary'}`} onClick={() => setFilter(f)} style={{ textTransform:'capitalize' }}>
            {f === 'all' ? `All (${agents.length})` : f === 'oncall' ? `On Call (${stats.oncall})` : f === 'available' ? `Available (${stats.available})` : f === 'paused' ? `Paused (${stats.paused})` : f === 'offline' ? `Offline (${stats.offline})` : 'Active'}
          </button>
        ))}
      </div>

      {/* Agent cards */}
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🎧</div><div className="empty-text">No agents found</div><div className="empty-sub">Agents appear here when they log in to the agent portal</div></div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:14 }}>
          {filtered.map(a => (
            <AgentCard key={a.id} agent={a} onMonitor={handleMonitor} onHangup={handleHangup} onForceLogout={handleForceLogout} monitorMode={monitoring[a.id]} onStopMonitor={handleStopMonitor} />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position:'fixed', bottom:24, right:24, zIndex:9999, minWidth:300,
          background:'linear-gradient(160deg,var(--bg-card),var(--bg-tertiary))',
          border:`1px solid ${toast.type==='success'?'rgba(0,230,118,0.3)':toast.type==='error'?'rgba(255,82,82,0.3)':'rgba(0,229,255,0.3)'}`,
          borderLeft:`3px solid ${toast.type==='success'?'var(--success)':toast.type==='error'?'var(--danger)':'var(--accent)'}`,
          borderRadius:'var(--radius-lg)', padding:'14px 18px', fontSize:13,
          boxShadow:'0 16px 40px rgba(0,0,0,0.6)', animation:'slideIn 0.2s ease',
          color:'var(--text-primary)', display:'flex', gap:10, alignItems:'center'
        }}>
          <span>{toast.type==='success'?'✅':toast.type==='error'?'❌':'ℹ️'}</span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
