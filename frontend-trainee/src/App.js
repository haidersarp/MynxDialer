import React, { useState, useEffect, useRef, useCallback } from 'react';
import { login, getSipConfig, getAgents, getContext, startListen, stopListen,
         TOKEN_KEY, USER_KEY } from './services/api';
import { initSIP, startListening, stopListening, stopSIP,
         setAudioElement, initKeepAlive } from './services/sipClient';
import AgentList from './components/AgentList';
import LeadSheet from './components/LeadSheet';
import ScriptPanel from './components/ScriptPanel';
import NotesPanel from './components/NotesPanel';
import './App.css';

// How often the shadow panel re-reads the agent's current call. Polling is a
// deliberate choice over hooking the dialer's socket emit path: the live call
// path stays untouched, so nothing here can disrupt a call in progress.
const CONTEXT_POLL_MS = 2000;
const AGENTS_POLL_MS  = 5000;

// The backend builds ws_servers from global env (ASTERISK_WS_HOST/PORT), which
// points every app at the AGENT container's nginx (:3001). That breaks the
// trainee line: this page is served from your-domain.com over a valid Let's
// Encrypt cert, and a WSS handshake to YOUR_SERVER_IP:3001 hits a SELF-SIGNED
// cert, which the browser blocks silently — registration then hangs forever on
// "Connecting…".
//
// Both nginx configs that serve this app already proxy /ws to Asterisk:8088
// (the host vhost for your-domain.com, and the trainee container for :3002),
// so using OUR OWN origin works in both cases with a cert the browser already
// trusts — it is the same cert that just served this page.
//
// Falls back to whatever the backend supplied if the page is not https.
function resolveWsUrl(fromServer) {
  try {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
      return `wss://${window.location.host}/ws`;
    }
  } catch (_) { /* fall through */ }
  return fromServer;
}

export default function App() {
  const [user, setUser]       = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  });
  const [agents, setAgents]   = useState([]);
  const [listeningTo, setListeningTo] = useState(null); // agent object
  const [context, setContext] = useState(null);
  const [sipState, setSipState] = useState('idle');     // idle|registering|ready|listening|error
  const [tab, setTab]         = useState('lead');       // lead|script
  const [error, setError]     = useState('');
  const audioRef              = useRef(null);

  // ── SIP registration (listen-only line) ───────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        setSipState('registering');
        const cfg = await getSipConfig();
        if (cancelled) return;
        initSIP({ ...cfg, ws_servers: resolveWsUrl(cfg.ws_servers) }, {
          onRegistered: () => setSipState('ready'),
          onRegistrationFailed: (c) => { setSipState('error'); setError(`SIP registration failed: ${c || 'unknown'}`); },
          onListening: () => setSipState('listening'),
          onStopped:   () => setSipState(s => (s === 'listening' ? 'ready' : s)),
          onFailed:    (c) => { setSipState('ready'); setError(`Could not start listening: ${c || 'unknown'}`); },
        });
      } catch (e) {
        if (!cancelled) {
          setSipState('error');
          setError(e.response?.data?.error || 'No SIP extension configured for this trainee account.');
        }
      }
    })();
    return () => { cancelled = true; stopSIP(); };
  }, [user]);

  useEffect(() => { setAudioElement(audioRef.current); }, [user]);

  // ── Poll the shadowable agent list ────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const list = await getAgents();
        if (alive) setAgents(list);
      } catch (_) { /* transient — keep last known list */ }
    };
    load();
    const t = setInterval(load, AGENTS_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // ── Poll the shadowed agent's live context (lead + script) ────────────────
  useEffect(() => {
    if (!user || !listeningTo) { setContext(null); return; }
    let alive = true;
    const load = async () => {
      try {
        const ctx = await getContext(listeningTo.id);
        if (alive) setContext(ctx);
      } catch (_) { /* transient */ }
    };
    load();
    const t = setInterval(load, CONTEXT_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [user, listeningTo]);

  const handleLogin = async (username, password) => {
    setError('');
    const res = await login(username, password);
    if (res.user?.role !== 'trainee') {
      throw new Error('This portal is for trainee accounts only.');
    }
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    initKeepAlive();
    setUser(res.user);
  };

  const handleLogout = () => {
    if (listeningTo) { stopListen(listeningTo.id).catch(() => {}); }
    stopSIP();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const handleListen = useCallback(async (agent) => {
    setError('');
    try {
      initKeepAlive(); // must run inside the click gesture for audio autoplay
      // Switching agents: tell the backend we left the previous one.
      if (listeningTo && listeningTo.id !== agent.id) {
        await stopListen(listeningTo.id).catch(() => {});
      }
      const res = await startListen(agent.id);
      startListening(res.dial_target);
      setListeningTo(agent);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Could not start listening.');
    }
  }, [listeningTo]);

  const handleStop = useCallback(async () => {
    stopListening();
    if (listeningTo) await stopListen(listeningTo.id).catch(() => {});
    setListeningTo(null);
    setContext(null);
  }, [listeningTo]);

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="tr-app">
      <header className="tr-top">
        <div className="tr-brand">
          <span className="tr-logo">MynxDialer</span>
          <span className="tr-badge">TRAINEE</span>
        </div>
        <div className="tr-top-right">
          <SipPill state={sipState} />
          <span className="tr-user">{user.full_name || user.username}</span>
          <button className="tr-btn tr-btn-ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <div className="tr-listen-banner">
        🎧 Listen-only. Your microphone is never used — the agent and customer
        cannot hear you.
      </div>

      {error && (
        <div className="tr-error" onClick={() => setError('')}>
          {error} <span className="tr-error-x">✕</span>
        </div>
      )}

      <main className="tr-main">
        <aside className="tr-col tr-col-agents">
          <AgentList
            agents={agents}
            listeningTo={listeningTo}
            onListen={handleListen}
            onStop={handleStop}
            disabled={sipState === 'error' || sipState === 'registering'}
          />
        </aside>

        <section className="tr-col tr-col-center">
          <div className="tr-tabs">
            <button className={`tr-tab ${tab === 'lead' ? 'is-active' : ''}`}
                    onClick={() => setTab('lead')}>Lead Sheet</button>
            <button className={`tr-tab ${tab === 'script' ? 'is-active' : ''}`}
                    onClick={() => setTab('script')}>Script</button>
          </div>
          {tab === 'lead'
            ? <LeadSheet context={context} agent={listeningTo} />
            : <ScriptPanel context={context} agent={listeningTo} />}
        </section>

        <aside className="tr-col tr-col-notes">
          <NotesPanel agent={listeningTo} context={context} />
        </aside>
      </main>

      {/* Remote (spied) audio sink. No local stream is ever attached. */}
      <audio ref={audioRef} autoPlay playsInline />

      {/* Persistent brand watermark — stays on the dialer at all times. */}
      <img className="tr-watermark" src={`${process.env.PUBLIC_URL}/logo.png`} alt="" aria-hidden="true" />
    </div>
  );
}

function SipPill({ state }) {
  const map = {
    idle:        ['Idle', 'grey'],
    registering: ['Connecting…', 'amber'],
    ready:       ['Ready', 'green'],
    listening:   ['Listening', 'live'],
    error:       ['SIP error', 'red'],
  };
  const [label, tone] = map[state] || map.idle;
  return <span className={`tr-pill tr-pill-${tone}`}>{label}</span>;
}

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await onLogin(username.trim(), password);
    } catch (e2) {
      setErr(e2.response?.data?.error || e2.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tr-login-wrap">
      <form className="tr-login" onSubmit={submit}>
        <img className="tr-login-logo" src={`${process.env.PUBLIC_URL}/logo.png`} alt="MynxDialer" />
        <div className="tr-login-brand">
          <span className="tr-logo">MynxDialer</span>
          <span className="tr-badge">TRAINEE</span>
        </div>
        <p className="tr-login-sub">Training portal · listen-only</p>
        <input className="tr-input" placeholder="Username" autoFocus
               value={username} onChange={e => setUsername(e.target.value)} />
        <input className="tr-input" placeholder="Password" type="password"
               value={password} onChange={e => setPassword(e.target.value)} />
        {err && <div className="tr-login-err">{err}</div>}
        <button className="tr-btn tr-btn-primary" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="tr-powered">Powered by <strong>Automynx</strong></p>
      </form>
    </div>
  );
}
