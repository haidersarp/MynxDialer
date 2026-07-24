import React, { useState, useEffect, useRef, useCallback } from 'react';
import { authAPI, sipAPI, agentAPI, campaignsAPI, adminAPI, callsAPI, leadsAPI } from './services/api';
import { getSocket, disconnectSocket } from './services/socket';
import { initSIP, hangup, hangupManual, mute, hold, stopSIP, isRegistered, answer, requestMicPermission, playDTMFTone, initKeepAlive, attachRemoteAudio, joinRoom, leaveRoom, isRoomCall } from './services/sipClient';
import TopBar from './components/TopBar';
import DialingTicker from './components/DialingTicker';
import LeftPanel from './components/LeftPanel';
import CustomerDetails from './components/CustomerDetails';
import TalkTrack from './components/TalkTrack';
import WebPhone from './components/WebPhone';
import DispositionModal from './components/DispositionModal';
import CallbackList from './components/CallbackList';
import ChatWidget from './components/ChatWidget';
import logo from './logo.png';

// ── Login ──────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [step, setStep] = useState('credentials'); // 'credentials' | 'campaign'
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [authedUser, setAuthedUser] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState('');

  const submitCredentials = async e => {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await authAPI.login(u, p);
      if (!['agent','supervisor'].includes(res.user.role)) throw new Error('Agent/supervisor access only');
      localStorage.setItem('agent_token', res.token);
      localStorage.setItem('agent_user', JSON.stringify(res.user));

      const list = await campaignsAPI.list().catch(() => []);
      const active = (list || []).filter(c => c.status === 'active' || c.status === 'paused');

      if (active.length === 0) {
        setErr('No campaigns are assigned to your account. Contact your administrator.');
        localStorage.removeItem('agent_token');
        localStorage.removeItem('agent_user');
        setLoading(false);
        return;
      }

      if (active.length === 1) {
        onLogin(res.user, active[0]);
        return;
      }

      setAuthedUser(res.user);
      setCampaigns(active);
      setSelectedId(String(active[0].id));
      setStep('campaign');
      setLoading(false);
    } catch (err) { setErr(err.error || err.message || 'Login failed'); setLoading(false); }
  };

  const submitCampaign = e => {
    e.preventDefault();
    const campaign = campaigns.find(c => c.id === parseInt(selectedId));
    if (!campaign) { setErr('Please select a campaign'); return; }
    onLogin(authedUser, campaign);
  };

  const back = () => {
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_user');
    setAuthedUser(null);
    setCampaigns([]);
    setErr('');
    setStep('credentials');
  };

  return (
    <div className="login-screen">
      <div style={{ width: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src={logo} alt="MynxDialer" style={{
            width: 72, height: 72, objectFit: 'contain', margin: '0 auto 16px', display: 'block'
          }} />
          <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 4, letterSpacing: '-1px', color: 'var(--text)' }}>MynxDialer</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14, fontWeight: 500 }}>
            {step === 'credentials' ? 'Agent Portal — Sign In' : `Welcome, ${authedUser?.full_name || authedUser?.username} — Choose a Campaign`}
          </p>
        </div>
        <div className="login-card">
          {err && (
            <div style={{ padding: '12px 16px', background: 'rgba(255,95,109,0.08)', border: '2px solid rgba(255,95,109,0.25)', borderRadius: 'var(--r)', color: 'var(--coral)', fontSize: 13, marginBottom: 16, fontWeight: 600 }}>
              {err}
            </div>
          )}

          {step === 'credentials' ? (
            <form onSubmit={submitCredentials}>
              <div style={{ marginBottom: 14 }}>
                <div className="field-label" style={{ marginBottom: 6 }}>Username</div>
                <input className="inp inp-lg" value={u} onChange={e => setU(e.target.value)} autoFocus required />
              </div>
              <div style={{ marginBottom: 24 }}>
                <div className="field-label" style={{ marginBottom: 6 }}>Password</div>
                <input className="inp inp-lg" type="password" value={p} onChange={e => setP(e.target.value)} required />
              </div>
              <button className="btn btn-cyan btn-xl" style={{ width: '100%', height: 48, fontSize: 14 }} disabled={loading}>
                {loading ? 'Signing in...' : '→ Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitCampaign}>
              <div style={{ marginBottom: 24 }}>
                <div className="field-label" style={{ marginBottom: 6 }}>Campaign</div>
                <select className="inp inp-lg sel" value={selectedId} onChange={e => setSelectedId(e.target.value)} autoFocus required>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>
                  Only campaigns your administrator has assigned to you are shown here.
                </p>
              </div>
              <button className="btn btn-cyan btn-xl" style={{ width: '100%', height: 48, fontSize: 14, marginBottom: 10 }}>
                → Enter Dashboard
              </button>
              <button type="button" className="btn btn-ghost" style={{ width: '100%', height: 38, fontSize: 12 }} onClick={back}>
                ← Back to sign in
              </button>
            </form>
          )}
        </div>
        <p style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>
          Agents only — Admin panel at port 3000
        </p>
        <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, letterSpacing: '.4px', opacity: 0.6 }}>
          Powered by <strong>Automynx</strong>
        </p>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
import SuspensionGate from './components/SuspensionGate';

export default function App() {
  const [user, setUser]   = useState(() => { try { return JSON.parse(localStorage.getItem('agent_user')); } catch { return null; } });
  const [selectedCampaign, setSelectedCampaign] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent_campaign')); } catch { return null; }
  });
  const [agentStatus, setAgentStatus]       = useState('offline');
  const [pauseCodes, setPauseCodes]         = useState([]);
  const [dispositions, setDispositions]     = useState([]);
  const [sipConfig, setSipConfig]           = useState(null);
  const [sipStatus, setSipStatus]           = useState('disconnected');
  const [callState, setCallState]           = useState(null);
  const [currentLead, setCurrentLead]       = useState(null);
  const [liveDialing, setLiveDialing]       = useState([]);
  const [showDispoModal, setShowDispoModal] = useState(false);
  const [isMuted, setIsMuted]               = useState(false);
  const [isOnHold, setIsOnHold]             = useState(false);
  const [incomingSession, setIncomingSession] = useState(null);
  const [pauseStart, setPauseStart]         = useState(null);
  const [callsInQueue, setCallsInQueue]     = useState(0);
  const [callbackRefresh, setCallbackRefresh] = useState(0);
  const [roomConnected, setRoomConnected]   = useState(false); // agent's *88 conference leg is up
  const [breakNote, setBreakNote]           = useState(null);  // free-text reason when the agent picks "Custom"
  // Draggable width of the Talk Track panel (Customer Details flexes to fill the rest).
  const [talkWidth, setTalkWidth] = useState(() => {
    const v = parseInt(localStorage.getItem('talkTrackWidth'), 10);
    return (v >= 180 && v <= 800) ? v : 280;
  });
  const startTalkResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = talkWidth;
    const onMove = (ev) => {
      // Handle sits on Talk Track's LEFT edge, so dragging left widens it.
      const w = Math.max(180, Math.min(800, startW + (startX - ev.clientX)));
      setTalkWidth(w);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setTalkWidth(w => { localStorage.setItem('talkTrackWidth', String(w)); return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const audioRef = useRef(null);
  const lastJoinRef = useRef(0); // throttle watchdog rejoins
  const agentStatusRef = useRef(agentStatus);
  useEffect(() => { agentStatusRef.current = agentStatus; }, [agentStatus]);

  const handleLogin = useCallback((u, campaign) => {
    // Start the keep-alive AudioContext from the login button gesture so
    // Chrome doesn't throttle/hibernate the tab. If the tab is throttled,
    // JsSIP's WebSocket keepalives stop, nginx times out the connection, and
    // Asterisk loses the SIP registration — calls can no longer reach the agent.
    initKeepAlive();
    setUser(u);
    const camp = campaign || null;
    setSelectedCampaign(camp);
    if (camp) localStorage.setItem('agent_campaign', JSON.stringify(camp));
    // Logged in but not yet taking calls — agent becomes "available" (and
    // eligible for the dialer) only after clicking "Start Calls".
    setAgentStatus('online');
  }, []);

  const handleLogout = useCallback(async () => {
    try { await authAPI.logout(); } catch (_) {}
    stopSIP(); disconnectSocket();
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_user');
    localStorage.removeItem('agent_campaign');
    setUser(null); setCallState(null); setCurrentLead(null); setSelectedCampaign(null);
    setSipConfig(null); setSipStatus('disconnected'); setAgentStatus('offline');
  }, []);

  // Initialize after login
  useEffect(() => {
    if (!user) return;

    adminAPI.pauseCodes().then(setPauseCodes).catch(() => {});

    // Request mic permission upfront so browser is ready when a call arrives
    requestMicPermission().then(granted => {
      if (!granted) console.warn('[App] No mic permission — audio will not work');
    });

    // SIP
    sipAPI.getConfig().then(config => {
      // When served from a real domain (e.g. your-domain.com), route the SIP
      // WebSocket through the SAME origin's /ws (valid Let's Encrypt cert via
      // nginx -> Asterisk). The backend hands out the raw-IP WSS (self-signed
      // cert), which the browser won't accept unless it's visited that IP:port
      // directly -> agent stuck "REGISTERING". On the raw-IP setup, keep the
      // backend-provided ws_servers unchanged (those agents work as-is).
      const h = window.location.hostname;
      if (window.location.protocol === 'https:' && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
        config = { ...config, ws_servers: `wss://${window.location.host}/ws` };
      }
      setSipConfig(config);
      setSipStatus('registering');
      initSIP(config, {
        onRegistered:        () => setSipStatus('registered'),
        onUnregistered:      () => setSipStatus('disconnected'),
        onRegistrationFailed:() => setSipStatus('failed'),
        onIncoming: (session, num, name) => {
          // Auto-answer calls from the dialer system (Asterisk bridging a lead).
          // In a predictive dialer, ALL incoming SIP calls come from the system.
          // Agents only make outbound calls manually; they never receive personal calls here.
          const isSystemCall = !num || num === '' || num === 'anonymous' ||
            name?.toLowerCase().includes('dialer') || name?.toLowerCase().includes('system') ||
            name?.toLowerCase().includes('blu') ||
            /^\d{7,}$/.test(num); // any 7+ digit number is a lead being bridged

          if (isSystemCall) {
            // Auto-answer: this is Asterisk bridging us to a lead (or audio check)
            console.log('[SIP] Auto-answering system call from:', num, name);
            answer(session);
            setCallState(prev => ({ ...(prev || {}), status: 'answered', answered_at: new Date().toISOString(), caller_id: num }));
            setAgentStatus('oncall');
          } else {
            // Manual incoming call — show UI for agent to answer
            setIncomingSession(session);
            setCallState(prev => ({ ...(prev || {}), incoming: true, caller_id: num, caller_name: name, status: 'ringing' }));
          }
        },
        onCallConfirmed: (session) => {
          // The room call (*88) is the agent's persistent audio leg — it must NOT
          // drive the lead UI (which is driven by socket events). Just mark the
          // room connected so we know the agent's audio is ready for leads.
          if (session?._isRoom) { setRoomConnected(true); return; }
          const now = new Date().toISOString();
          setCallState(prev => ({ ...(prev || {}), status: 'answered', answered_at: now }));
          setAgentStatus('oncall');
        },
        onCallEnded: (cause, session) => {
          setIncomingSession(null);
          setIsMuted(false);
          setIsOnHold(false);
          // Room leg ended (agent toggled OFFLINE, or it dropped). Just clear the
          // flag — do NOT auto-rejoin (that loop spammed "conference is locked" and
          // piled up stale room sessions). The agent re-joins via the ONLINE toggle.
          if (session?._isRoom) { setRoomConnected(false); return; }
          // For manual calls (no DB call ID), clear state entirely.
          // For autodialer calls, preserve callState so disposition modal can show.
          setCallState(prev => prev?.id ? { ...prev, status: 'ended' } : null);
          setAgentStatus(prev => prev === 'oncall' ? 'available' : prev);
        },
        onCallFailed: (cause, session) => {
          console.log('[App] Call failed:', cause);
          setIncomingSession(null);
          if (session?._isRoom) { setRoomConnected(false); return; }
          setCallState(null);
          setAgentStatus(prev => prev === 'oncall' ? 'available' : prev);
        },
        onRemoteStream: (stream) => {
          // Always attach — for the conference flow this stream is the room mix
          // (silence while waiting, the lead's voice once they're bridged in).
          const tracks = stream?.getAudioTracks?.() || [];
          console.log('[SIP] Remote stream — audio tracks:', tracks.length, tracks.map(t => t.readyState));
          attachRemoteAudio(stream, audioRef.current);
        },
        onOutgoing: (session) => {
          // The room call going out must stay invisible to the lead UI — the agent
          // shows "waiting for lead", not "on call", until a lead is socket-assigned.
          if (session?._isRoom) return;
          // Manual outbound call — show ringing UI immediately (flagged manual so
          // hangup targets this browser leg, not the room / a DB lead call).
          const dialed = session?.remote_identity?.uri?.user || '';
          setCallState(prev => ({ ...(prev || {}), status: 'ringing', outbound: true, manual: true, caller_id: dialed }));
          setAgentStatus('oncall');
          const digits = dialed.replace(/\D/g, '');
          if (digits.length < 7) return;
          // Show the lead sheet if the number is in our (account-scoped) data, then
          // log a call record so this manual call gets full hangup & disposition.
          const finish = (match) => {
            if (match) setCurrentLead(match);
            callsAPI.manual({ phone: digits, lead_id: match ? match.id : undefined })
              .then(r => {
                if (r && r.call_id) setCallState(prev => (prev && prev.manual)
                  ? { ...prev, id: r.call_id, lead_id: match ? match.id : null } : prev);
              })
              .catch(() => {});
          };
          leadsAPI.search(digits).then(res => {
            const list = res?.leads || res?.data?.leads || [];
            const match = list.find(l => {
              const p = (l.phone || '').replace(/\D/g, '');
              return p && (p.endsWith(digits) || digits.endsWith(p));
            }) || null;
            finish(match);
          }).catch(() => finish(null));
        },
        onMuted: (m) => setIsMuted(m),
        onHold:  (h) => setIsOnHold(h)
      });
    }).catch(err => { console.warn('[SIP] Not configured:', err.error || err.message); setSipStatus('failed'); });

    // Socket
    const socket = getSocket();

    socket.on('call:assigned', (data) => {
      // Don't downgrade an already-answered call back to ringing if events arrive out of order
      setCallState(prev => {
        if (prev?.status === 'answered' || prev?.status === 'ended') {
          return { ...prev, id: data.call_id, lead_id: data.lead_id, caller_id: data.caller_id || prev.caller_id };
        }
        return { id: data.call_id, lead_id: data.lead_id, caller_id: data.caller_id, status: 'ringing', incoming: false };
      });
      if (data.lead) setCurrentLead(data.lead);
      setLiveDialing(prev => [...prev.filter(x => x.id !== data.call_id), { id: data.call_id, phone: data.lead?.phone || data.caller_id, status: 'ringing', startedAt: new Date().toISOString() }]);
    });

    socket.on('call:answered', (data) => {
      // Always create callState even if call:assigned was missed — ensures timer starts
      setCallState(prev => ({
        ...(prev || { id: data.call_id, incoming: false }),
        status: 'answered',
        answered_at: new Date().toISOString()
      }));
      setAgentStatus('oncall');
      setLiveDialing(prev => prev.map(x => x.id === data.call_id ? { ...x, status: 'answered' } : x));
    });

    socket.on('call:hangup', (data) => {
      setIsMuted(false); setIsOnHold(false);
      setLiveDialing(prev => prev.filter(x => x.id !== data.call_id));
      if (data.reaped) {
        // Backend auto-cleaned an abandoned/undisposed call — clear the UI; free.
        setCallState(null); setCurrentLead(null); setAgentStatus('available');
        setShowDispoModal(false);
        return;
      }
      // Customer hung up. Mark the call ended and prompt a disposition. Do NOT go
      // 'available' — staying in wrap-up keeps the dialer from grabbing the next
      // lead before this one is dispositioned (that race caused the button flicker
      // and leads piling up). Becomes 'available' again on disposition submit.
      setCallState(prev => prev ? { ...prev, status: 'ended', ended_at: new Date().toISOString() } : prev);
      if (data.needs_disposition) setShowDispoModal(true);
    });

    socket.on('call:started', (data) => {
      setLiveDialing(prev => [...prev.filter(x => x.id !== data.call_id), { id: data.call_id, phone: data.phone, status: 'dialing', startedAt: new Date().toISOString() }]);
      setCallsInQueue(q => Math.max(0, q + 1));
    });

    socket.on('lead:assigned', (data) => setCurrentLead(data.lead));

    socket.on('force:logout', () => {
      alert('You have been logged out by an administrator.');
      handleLogout();
    });

    return () => {
      socket.off('call:assigned'); socket.off('call:answered'); socket.off('call:hangup');
      socket.off('call:started'); socket.off('lead:assigned');
    };
  }, [user]);

  // Load dispositions when campaign changes + register initial session
  useEffect(() => {
    if (!selectedCampaign || !user) return;
    adminAPI.dispositions(selectedCampaign.id).then(setDispositions).catch(() => {});
    agentAPI.loginCampaign(user.id, selectedCampaign.id).catch(() => {});

    // Restore session after socket reconnect (e.g. backend restart, network blip).
    // Socket disconnect fires the backend handler that closes ALL open sessions.
    // The reconnect itself does NOT recreate them — this handler does.
    const socket = getSocket();
    const handleReconnect = async () => {
      const prevStatus = agentStatusRef.current;
      // While on a call the AMI Hangup handler needs the existing session intact —
      // calling loginCampaign here would close it and break status reset on hangup.
      if (prevStatus === 'oncall') return;
      console.log('[Socket] Reconnected — restoring agent session for campaign', selectedCampaign.id);
      await agentAPI.loginCampaign(user.id, selectedCampaign.id).catch(() => {});
      if (prevStatus === 'available') {
        await agentAPI.setStatus(user.id, 'available', null, selectedCampaign.id).catch(() => {});
        setAgentStatus('available');
      }
    };
    socket.on('reconnect', handleReconnect);
    return () => socket.off('reconnect', handleReconnect);
  }, [selectedCampaign, user]);

  // Recover the lead sheet if 'call:assigned' was missed (socket mid-reconnect):
  // a call can be answered with the lead data event dropped, leaving the sheet
  // blank. When answered but no lead is shown, fetch the active call's lead so
  // the agent always sees the customer's data. The 1.5s delay lets the normal
  // event arrive first; the currentLead dep cancels the fetch if it does.
  useEffect(() => {
    if (callState?.status !== 'answered' || !callState?.id || currentLead) return;
    const callId = callState.id;
    const t = setTimeout(async () => {
      try {
        const active = await callsAPI.active();
        const list = Array.isArray(active) ? active : (active?.data || []);
        const mine = list.find(c => c.id === callId);
        if (mine?.lead_id) {
          const lead = await leadsAPI.get(mine.lead_id);
          setCurrentLead(prev => prev || lead);
        }
      } catch (_) { /* best-effort recovery */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [callState?.status, callState?.id, currentLead]);

  // Watchdog: keep the agent's conference-room leg alive. If the room call drops
  // while the agent should be in it (e.g. Chrome suspended a backgrounded tab and
  // Asterisk's rtp_timeout cleared the dead call), rejoin — throttled so it can't
  // loop. Also nudge the <audio> element to keep playing if the tab paused it.
  useEffect(() => {
    if (!user) return;
    const wd = setInterval(() => {
      const st = agentStatusRef.current;
      const shouldBeInRoom = st === 'online' || st === 'available' || st === 'oncall';
      if (shouldBeInRoom && !roomConnected && sipConfig && Date.now() - lastJoinRef.current > 7000) {
        console.log('[App] Watchdog: room leg missing — rejoining');
        lastJoinRef.current = Date.now();
        try { joinRoom(sipConfig); } catch (_) {}
      }
      const a = audioRef.current;
      if (a && a.paused && a.srcObject) a.play().catch(() => {});
    }, 5000);
    return () => clearInterval(wd);
  }, [user, roomConnected, sipConfig]);

  // Auto-expire stale entries from the Live Dialing ticker. Predictive calls that
  // didn't connect to THIS agent never send a removal event, so prune in-flight
  // (dialing/ringing) rows older than 20s. The agent's own connected call shows as
  // 'answered' and is removed by call:hangup, so it's left alone here.
  useEffect(() => {
    const iv = setInterval(() => {
      const cutoff = Date.now() - 20000;
      setLiveDialing(prev => {
        const next = prev.filter(x => !(['dialing', 'ringing'].includes(x.status) && new Date(x.startedAt).getTime() < cutoff));
        return next.length === prev.length ? prev : next;
      });
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  const handleStatusChange = async (status, pcId, note) => {
    setAgentStatus(status);
    if (status === 'paused') { setPauseStart(new Date().toISOString()); setBreakNote(note || null); }
    else { setPauseStart(null); setBreakNote(null); }
    try {
      await agentAPI.setStatus(user.id, status, pcId, selectedCampaign?.id, note);
      getSocket().emit('agent:status', { status, pause_code_id: pcId, note: note || null });
    } catch (err) { console.error(err); }
  };

  // Toggles whether the agent is connected to live auto-dial calls.
  // This is the ONLY thing that makes the agent eligible for the dialer
  // (status = 'available'). It no longer touches presence or the audio check.
  const handleStartCalls = async () => {
    const goingLive = agentStatus !== 'available';
    if (goingLive) {
      // Keep the tab active so Chrome doesn't hibernate it and miss SIP INVITEs
      initKeepAlive();
      // You must be in your conference room to receive leads. If you started calls
      // without going ONLINE first, join the room now (auto go-online).
      if (!roomConnected) {
        lastJoinRef.current = Date.now();
        try { joinRoom(sipConfig); } catch (e) { console.warn('[App] joinRoom failed:', e.message); }
      }
      // Recreate the campaign session so claimAgent() finds an agent_sessions row.
      if (selectedCampaign) {
        await agentAPI.loginCampaign(user.id, selectedCampaign.id).catch(() => {});
      }
      // status='available' is what makes the dialer start dispatching leads.
      await handleStatusChange('available', null);
    } else {
      // Stop Calls — stop receiving autodial leads but STAY in the room (online).
      // Clear any leftover ended-call so a finished lead doesn't linger on screen.
      if (!callState || callState.status === 'ended') {
        setCallState(null); setCurrentLead(null); setShowDispoModal(false);
      }
      await handleStatusChange('online', null);
    }
  };

  // Online/Offline presence toggle — independent of live-call connection.
  // Going back online re-establishes the campaign session (offline closes it).
  // ONLINE/OFFLINE = in/out of the conference room. ONLINE joins the agent's room
  // (they hear "you are the only person" then hold music while waiting); OFFLINE
  // leaves it entirely. Going available for autodial (Start Calls) requires ONLINE.
  const handleToggleOnline = async () => {
    if (agentStatus === 'offline') {
      initKeepAlive();
      if (selectedCampaign) await agentAPI.loginCampaign(user.id, selectedCampaign.id).catch(() => {});
      if (!roomConnected) {
        lastJoinRef.current = Date.now();
        try { joinRoom(sipConfig); } catch (e) { console.warn('[App] joinRoom failed:', e.message); }
      }
      await handleStatusChange('online', null);
    } else {
      // Leaving — drop out of autodial AND leave the room.
      try { leaveRoom(); } catch (_) {}
      setRoomConnected(false);
      await handleStatusChange('offline', null);
    }
  };

  // Manually trigger the "you are the only person in this conference" audio
  // check — fully decoupled from Start Calls so agents can test audio anytime.
  const handleAudioCheck = async () => {
    try { await agentAPI.audioCheck(user.id); } catch (_) {}
  };

  const handleResume = () => handleStatusChange('available', null);

  const handleHangupAndDispo = async () => {
    // Manual call whose record failed to log → just hang up (nothing to dispo).
    if (callState?.manual && !callState.id) { handleHangup(); return; }
    // If the call is still live, HANG IT UP NOW (the agent chose to end it) and
    // enter wrap-up. The agent stays NOT-available until a disposition is
    // submitted — closing the dispo (X) only returns to the lead sheet; it does
    // NOT free them. Only handleDispositionSubmit sets 'available'.
    if (callState && callState.status !== 'ended') {
      if (callState.manual) {
        hangupManual();
      } else {
        if (!roomConnected) hangup();
        if (callState.id) await callsAPI.hangup(callState.id).catch(() => {});
      }
      setCallState(prev => prev ? { ...prev, status: 'ended', ended_at: new Date().toISOString() } : prev);
      setIsMuted(false); setIsOnHold(false);
    }
    setShowDispoModal(true);
  };

  const handleDispositionSubmit = async (dispId, notes, callbackAt, pauseCodeId) => {
    const callId = callState?.id;
    try {
      if (callId) {
        await callsAPI.disposition(callId, { disposition_id: dispId, notes, callback_at: callbackAt });
        if (callState.manual) {
          // Manual call: end the browser leg; the disposition already stamped
          // hung_up_at on the record. Never touch the room (*88) leg.
          hangupManual();
        } else {
          // Conference mode: the SIP session IS the agent's room — never terminate it.
          // The backend hangs up the lead's leg; the agent stays for the next lead.
          if (!roomConnected) hangup();
          await callsAPI.hangup(callId).catch(() => {});
        }
      }
    } catch (err) { console.error(err); }
    // ALWAYS clean up + free the agent — even if the call id was already gone (a
    // race), never leave them stranded in wrap-up (that stalled their Live Dialing).
    setShowDispoModal(false);
    setCallState(null);
    setCurrentLead(null);
    setIsMuted(false); setIsOnHold(false);
    setLiveDialing(prev => prev.filter(x => x.id !== callId));
    if (pauseCodeId) {
      await handleStatusChange('paused', pauseCodeId);
    } else {
      setAgentStatus('available');
    }
    // Trigger callback list refresh if a callback was set
    if (callbackAt) setCallbackRefresh(n => n + 1);
  };

  // The call is already hung up (Hangup & Dispo ended it). Closing the dispo (X /
  // Cancel / backdrop) just returns to the lead sheet in WRAP-UP — the agent must
  // submit a disposition to go available. They can re-open the dispo any time via
  // the Hangup & Dispo button (which skips the hang-up since the call already ended).
  const handleDispoClose = () => {
    setShowDispoModal(false);
  };

  const handlePauseNow = async (pauseCodeId) => {
    if (!roomConnected) hangup();
    if (callState?.id) await callsAPI.hangup(callState.id).catch(() => {});
    setCallState(null); setCurrentLead(null);
    setIsMuted(false); setIsOnHold(false);
    await handleStatusChange('paused', pauseCodeId || null);
  };

  const handleHangup = async () => {
    // Manual dial: terminate ONLY that browser leg via hangupManual() — never the
    // room (*88) leg. Also close the DB call record if one was logged.
    if (callState?.manual) {
      hangupManual();
      if (callState.id) await callsAPI.hangup(callState.id).catch(() => {});
      setCurrentLead(null); // clear the manual lead sheet
    } else {
      if (!roomConnected) hangup();
      if (callState?.id) await callsAPI.hangup(callState.id).catch(() => {});
    }
    setCallState(null);
    setAgentStatus('available');
    setIsMuted(false); setIsOnHold(false);
  };

  const handleAnswer = () => {
    answer(incomingSession);
    setIncomingSession(null);
    setCallState(prev => ({ ...(prev || {}), status: 'answered', answered_at: new Date().toISOString() }));
    setAgentStatus('oncall');
  };

  const handleMute = () => { mute(!isMuted); setIsMuted(m => !m); };
  const handleHold = () => { hold(!isOnHold); setIsOnHold(h => !h); };

  if (!user) return <LoginScreen onLogin={handleLogin} />;

  const hasCall = callState && ['ringing','answered'].includes(callState.status);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)', overflow: 'hidden' }}>
      <SuspensionGate role="agent" />
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />

      <TopBar
        user={user}
        agentStatus={agentStatus}
        selectedCampaign={selectedCampaign}
        pauseCodes={pauseCodes}
        callState={callState}
        pauseStart={pauseStart}
        breakNote={breakNote}
        callsInQueue={callsInQueue}
        onStartCalls={handleStartCalls}
        onToggleOnline={handleToggleOnline}
        onAudioCheck={handleAudioCheck}
        onResume={handleResume}
        onHangupAndDispo={handleHangupAndDispo}
        onStatusChange={handleStatusChange}
        onLogout={handleLogout}
      />

      <DialingTicker liveDialing={liveDialing} totalDialing={liveDialing.length} />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        <LeftPanel
          user={user}
          sipConfig={sipConfig}
          sipStatus={sipStatus}
          callState={callState}
          onHangup={handleHangup}
        />

        <CustomerDetails
          lead={currentLead}
          callState={callState}
          campaignName={selectedCampaign?.name}
        />

        {/* Draggable divider — resize the Talk Track panel (Customer Details fills the rest) */}
        <div
          onMouseDown={startTalkResize}
          title="Drag to resize Talk Track"
          style={{ width: 6, flexShrink: 0, cursor: 'col-resize', background: 'var(--border-dim)', transition: 'background 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--cyan)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--border-dim)'; }}
        />

        <TalkTrack campaign={selectedCampaign} width={talkWidth} />

        <div style={{ width: 240, display: 'flex', flexDirection: 'column', overflow: 'visible', flexShrink: 0, position: 'relative' }}>
          <WebPhone
            sipStatus={sipStatus}
            callState={callState}
            sipConfig={sipConfig}
            isMuted={isMuted}
            isOnHold={isOnHold}
            incomingSession={incomingSession}
            onAnswer={handleAnswer}
            onHangup={handleHangup}
            onMute={handleMute}
            onHold={handleHold}
            onDTMF={(d) => { const { sendDTMF } = require('./services/sipClient'); sendDTMF(d); }}
          />
          <CallbackList sipConfig={sipConfig} refreshTrigger={callbackRefresh} />
        </div>
      </div>

      {showDispoModal && (
        <DispositionModal
          dispositions={dispositions}
          onSubmit={handleDispositionSubmit}
          onPause={handlePauseNow}
          onClose={handleDispoClose}
        />
      )}

      {/* Internal team chat (rides existing socket; no call impact) */}
      <ChatWidget user={user} campaignId={selectedCampaign?.id} campaignName={selectedCampaign?.name} />

      {/* Persistent brand watermark — stays on the dialer at all times. */}
      <img src={logo} alt="" aria-hidden="true" style={{
        position: 'fixed', bottom: 12, right: 14, width: 38, height: 38,
        objectFit: 'contain', opacity: 0.12, pointerEvents: 'none', zIndex: 5, userSelect: 'none'
      }} />
    </div>
  );
}
