import React, { useState, useEffect } from 'react';
import logo from '../logo.png';

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setT(new Date()), 1000); return () => clearInterval(iv); }, []);
  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text2)', letterSpacing: 1, fontWeight: 600 }}>
      {t.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}

function Timer({ start, running, color, size }) {
  const [display, setDisplay] = useState('00:00:00');
  useEffect(() => {
    const tick = () => {
      if (!running && !start) { setDisplay('00:00:00'); return; }
      const elapsed = Math.floor((Date.now() - (start ? new Date(start).getTime() : Date.now())) / 1000);
      const h = Math.floor(elapsed / 3600), m = Math.floor((elapsed % 3600) / 60), s = elapsed % 60;
      setDisplay(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);
    };
    tick();
    if (!running && !start) return;
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [running, start]);
  return <span style={{ fontFamily: 'var(--mono)', fontSize: size || 14, fontWeight: 800, color: color || 'var(--text2)' }}>{display}</span>;
}

export default function TopBar({ user, agentStatus, selectedCampaign, pauseCodes, callState, pauseStart, breakNote, callsInQueue, onStartCalls, onToggleOnline, onAudioCheck, onResume, onHangupAndDispo, onStatusChange, onLogout }) {
  const [showPause, setShowPause] = useState(false);
  const [showBreakMenu, setShowBreakMenu] = useState(false);
  const [breakTip, setBreakTip] = useState(null);   // cloud tooltip next to Break
  const [startTip, setStartTip] = useState(false);  // cloud tooltip under Start Calls
  const [customMode, setCustomMode] = useState(false); // agent is typing a "Custom" reason
  const [customText, setCustomText] = useState('');
  const flashBreakTip = (msg) => { setBreakTip(msg); setTimeout(() => setBreakTip(null), 1500); };
  // Break reasons: fixed ones (alphabetical) first, then "Custom" last.
  const activeCodes = (pauseCodes || []).filter(p => p.active);
  const customCode  = activeCodes.find(p => p.code === 'CUSTOM' || p.label === 'Custom');
  const normalCodes = activeCodes.filter(p => p !== customCode).sort((a, b) => a.label.localeCompare(b.label));
  const closeBreakMenu = () => { setShowBreakMenu(false); setCustomMode(false); setCustomText(''); };
  const submitCustom = () => {
    const note = customText.trim();
    if (!note || !customCode) return;
    closeBreakMenu();
    onStatusChange('paused', customCode.id, note);
  };
  const isOnCall = agentStatus === 'oncall';
  const isPaused = agentStatus === 'paused';
  const isOffline = agentStatus === 'offline';
  const isLive = agentStatus === 'available' || isOnCall;
  const hasCall  = callState && ['ringing','answered'].includes(callState.status);
  // The disposition button must stay active after the customer hangs up ('ended')
  // so the agent can actually dispose the call (otherwise it greys out on hangup).
  const canDispo = callState && ['ringing','answered','ended'].includes(callState.status);

  const statusColors = { available: 'var(--green)', oncall: 'var(--coral)', paused: 'var(--orange)', online: 'var(--blue)', offline: 'var(--text2)' };
  const statusBg     = { available: 'rgba(16,185,129,0.1)', oncall: 'rgba(255,95,109,0.1)', paused: 'rgba(245,158,11,0.1)', online: 'rgba(59,130,246,0.1)', offline: '#f3f4f6' };
  const statusBorder = { available: 'rgba(16,185,129,0.3)', oncall: 'rgba(255,95,109,0.3)', paused: 'rgba(245,158,11,0.3)', online: 'rgba(59,130,246,0.3)', offline: '#e5e7eb' };

  return (
    <header style={{
      minHeight: 56,
      background: '#ffffff',
      borderBottom: '2px solid var(--border)',
      // Wrap onto a second row on small screens (e.g. a MacBook) so the right-side
      // cluster (status, queue, username, Logout) is never clipped off-screen.
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', padding: '6px 14px',
      rowGap: 6, gap: 8, flexShrink: 0,
      boxShadow: '0 2px 12px rgba(124,58,237,0.08)'
    }}>
      {/* Logo */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginRight:6, flexShrink:0 }}>
        <img src={logo} alt="Automynx" style={{
          width:32, height:32, objectFit:'contain',
        }} />
        <div>
          <div style={{ fontWeight:900, fontSize:14, letterSpacing:'-0.5px', color:'var(--text)', lineHeight:1 }}>{user?.account_name || 'MynxDialer'}</div>
          <div style={{ fontSize:9, color:'var(--purple)', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase' }}>Agent Portal</div>
        </div>
      </div>

      <div style={{ width:1, height:28, background:'var(--border)', flexShrink:0 }} />

      {/* Online/Offline presence toggle — independent of live-dialer connection */}
      <button
        onClick={onToggleOnline}
        disabled={isOnCall}
        title="Toggle your online/offline presence"
        style={{
          display:'flex', alignItems:'center', gap:8, padding:'5px 12px 5px 5px', height:34,
          borderRadius:100, cursor: isOnCall ? 'default' : 'pointer',
          border: `2px solid ${isOffline ? '#e5e7eb' : 'rgba(59,130,246,0.3)'}`,
          background: isOffline ? '#f3f4f6' : 'rgba(59,130,246,0.1)',
          fontWeight:800, fontSize:11, textTransform:'uppercase', letterSpacing:'0.05em',
          color: isOffline ? 'var(--text2)' : 'var(--blue)', flexShrink:0,
          opacity: isOnCall ? 0.6 : 1, transition:'all 0.2s'
        }}
      >
        <span style={{ position:'relative', width:34, height:20, borderRadius:100, background: isOffline ? '#d1d5db' : 'var(--blue)', transition:'background 0.2s', flexShrink:0 }}>
          <span style={{ position:'absolute', top:2, left: isOffline ? 2 : 16, width:16, height:16, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,0.35)', transition:'left 0.2s' }} />
        </span>
        {isOffline ? 'Offline' : 'Online'}
      </button>

      {/* Live auto-dial connection — purely controls whether the agent is in the dialer queue */}
      <div style={{ position:'relative', flexShrink:0 }}>
        <button
          className={isLive ? 'btn btn-orange' : 'btn btn-green'}
          style={{ height:34 }}
          disabled={isOnCall || isOffline}
          title={isLive ? 'Disconnect from live auto-dial calls' : 'Connect to live auto-dial calls'}
          onClick={() => {
            // Can't start calls while on a break — nudge the agent to end it first.
            if (isPaused) { setStartTip(true); setTimeout(() => setStartTip(false), 1500); return; }
            onStartCalls();
          }}
        >
          {isLive ? '⏸ Stop Calls' : '▶ Start Calls'}
        </button>
        {startTip && (
          <div style={{ position:'absolute', top:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)', background:'#1f2937', color:'#fff', padding:'7px 11px', borderRadius:10, fontSize:11, fontWeight:600, whiteSpace:'nowrap', zIndex:300, boxShadow:'0 6px 20px rgba(0,0,0,0.28)' }}>
            End your break first ☕
          </div>
        )}
      </div>

      {/* Break — usable only when calls are stopped; on break it flips to "End Break" */}
      <div style={{ position:'relative', flexShrink:0 }}>
        <button
          className={isPaused ? 'btn btn-orange' : 'btn'}
          style={isPaused ? { height:34 } : { height:34, background:'linear-gradient(135deg,#8b5cf6,#7c3aed)', color:'#fff', border:'none', boxShadow:'0 4px 12px rgba(139,92,246,0.35)' }}
          title={isPaused ? 'End your break' : 'Take a break (stop calls first)'}
          onClick={() => {
            if (isPaused) { setShowBreakMenu(false); onStatusChange('online', null); return; } // end break -> online
            if (isLive)   { flashBreakTip('Press "Stop Calls" first'); return; }
            if (isOffline){ flashBreakTip('Go Online first'); return; }
            setShowBreakMenu(v => !v); // online & calls stopped -> pick a reason
          }}
        >
          {isPaused ? '☕ End Break' : '☕ Break'}
        </button>
        {breakTip && (
          <div style={{ position:'absolute', top:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)', background:'#1f2937', color:'#fff', padding:'7px 11px', borderRadius:10, fontSize:11, fontWeight:600, whiteSpace:'nowrap', zIndex:300, boxShadow:'0 6px 20px rgba(0,0,0,0.28)' }}>
            {breakTip}
          </div>
        )}
        {showBreakMenu && !isPaused && (
          <div style={{ position:'absolute', top:'110%', left:0, zIndex:200, background:'#fff', border:'2px solid var(--border)', borderRadius:14, minWidth:200, boxShadow:'0 12px 32px rgba(124,58,237,0.15)', overflow:'hidden' }}>
            <div style={{ padding:'8px 14px', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', borderBottom:'2px solid var(--border)', background:'var(--bg-elevated)' }}>
              Break reason
            </div>
            {normalCodes.map(pc => (
              <button key={pc.id}
                onClick={() => { closeBreakMenu(); onStatusChange('paused', pc.id); }}
                style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', color:'var(--text)', cursor:'pointer', fontSize:12, fontWeight:600, textAlign:'left', borderBottom:'1px solid var(--border)' }}
                onMouseEnter={e => { e.target.style.background = 'var(--bg-hover)'; e.target.style.color = 'var(--purple)'; }}
                onMouseLeave={e => { e.target.style.background = 'none'; e.target.style.color = 'var(--text)'; }}>
                ☕ {pc.label}
              </button>
            ))}
            {customCode && !customMode && (
              <button
                onClick={() => setCustomMode(true)}
                style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', color:'var(--purple)', cursor:'pointer', fontSize:12, fontWeight:700, textAlign:'left', borderBottom:'1px solid var(--border)' }}
                onMouseEnter={e => { e.target.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { e.target.style.background = 'none'; }}>
                ✏️ Custom…
              </button>
            )}
            {customCode && customMode && (
              <div style={{ padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
                <input autoFocus className="inp"
                  placeholder="Type your reason…"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitCustom(); }}
                  style={{ width:'100%', marginBottom:8, fontSize:12 }} />
                <button
                  disabled={!customText.trim()}
                  onClick={submitCustom}
                  style={{ width:'100%', padding:'8px', borderRadius:8, border:'none', cursor: customText.trim() ? 'pointer' : 'default', color:'#fff', fontSize:12, fontWeight:700, background: customText.trim() ? 'linear-gradient(135deg,#8b5cf6,#7c3aed)' : '#c4b5fd' }}>
                  ☕ Go on Break
                </button>
              </div>
            )}
            <button onClick={closeBreakMenu} style={{ display:'block', width:'100%', padding:'8px 14px', background:'none', border:'none', color:'var(--text2)', cursor:'pointer', fontSize:11, fontWeight:600 }}>Cancel</button>
          </div>
        )}
      </div>

      {/* Show the typed reason while on a custom break */}
      {isPaused && breakNote && (
        <span title={breakNote} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:100, background:'rgba(139,92,246,0.12)', border:'1px solid rgba(139,92,246,0.35)', color:'var(--purple)', fontSize:11, fontWeight:700, flexShrink:0, maxWidth:170, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          ☕ {breakNote}
        </span>
      )}

      <button className="btn btn-red" style={{ height:34 }} disabled={!canDispo} onClick={onHangupAndDispo}>
        ✕ Hangup &amp; Dispo
      </button>

      {/* Campaign — chosen at login, fixed for the session */}
      <div style={{
        display:'flex', alignItems:'center', gap:6, padding:'6px 14px',
        background:'rgba(124,58,237,0.06)', border:'2px solid rgba(124,58,237,0.18)',
        borderRadius:100, fontSize:12, fontWeight:700, color:'var(--purple)', whiteSpace:'nowrap'
      }} title="Campaign is selected at login">
        <span style={{ fontSize:9, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', fontWeight:800 }}>Campaign</span>
        {selectedCampaign?.name || '—'}
      </div>

      <div style={{ width:1, height:28, background:'var(--border)', flexShrink:0 }} />

      {/* Status badge */}
      <div style={{ position:'relative' }}>
        <div
          onClick={() => !isOnCall && setShowPause(!showPause)}
          style={{
            display:'inline-flex', alignItems:'center', gap:7, padding:'5px 14px',
            borderRadius:100, cursor:'pointer', fontWeight:800, fontSize:11,
            textTransform:'uppercase', letterSpacing:'0.05em',
            background: statusBg[agentStatus] || '#f3f4f6',
            color: statusColors[agentStatus] || 'var(--text2)',
            border: `2px solid ${statusBorder[agentStatus] || '#e5e7eb'}`,
            transition:'all 0.2s',
          }}
        >
          <span style={{ width:8, height:8, borderRadius:'50%', background:'currentColor', display:'inline-block', boxShadow: agentStatus === 'available' ? '0 0 0 3px rgba(16,185,129,0.2)' : agentStatus === 'oncall' ? '0 0 0 3px rgba(255,95,109,0.2)' : 'none' }} />
          {agentStatus?.toUpperCase() || 'OFFLINE'}
        </div>

        {showPause && (
          <div style={{ position:'absolute', top:'110%', left:0, zIndex:200, background:'#fff', border:'2px solid var(--border)', borderRadius:14, minWidth:200, boxShadow:'0 12px 32px rgba(124,58,237,0.15)', overflow:'hidden' }}>
            <div style={{ padding:'8px 14px', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', borderBottom:'2px solid var(--border)', background:'var(--bg-elevated)' }}>
              Set Status
            </div>
            <button onClick={() => { setShowPause(false); onStatusChange('available', null); }}
              style={{ display:'block', width:'100%', padding:'10px 14px', background:'none', border:'none', color:'var(--green)', cursor:'pointer', fontSize:12, fontWeight:700, textAlign:'left', borderBottom:'1px solid var(--border)' }}>
              ● AVAILABLE
            </button>
            {pauseCodes.filter(p => p.active).map(pc => (
              <button key={pc.id}
                onClick={() => { setShowPause(false); onStatusChange('paused', pc.id); }}
                style={{ display:'block', width:'100%', padding:'9px 14px', background:'none', border:'none', color:'var(--text)', cursor:'pointer', fontSize:12, fontWeight:600, textAlign:'left', borderBottom:'1px solid var(--border)' }}
                onMouseEnter={e => { e.target.style.background = 'var(--bg-hover)'; e.target.style.color = 'var(--purple)'; }}
                onMouseLeave={e => { e.target.style.background = 'none'; e.target.style.color = 'var(--text)'; }}>
                ⏸ {pc.label}
              </button>
            ))}
            <button onClick={() => setShowPause(false)} style={{ display:'block', width:'100%', padding:'8px 14px', background:'none', border:'none', color:'var(--text2)', cursor:'pointer', fontSize:11, fontWeight:600 }}>Cancel</button>
          </div>
        )}
      </div>

      <Timer start={isPaused ? pauseStart : isOnCall ? callState?.answered_at : null} running={isPaused || isOnCall} color={isPaused ? 'var(--orange)' : isOnCall ? 'var(--coral)' : 'var(--text2)'} />

      <div style={{ width:1, height:28, background:'var(--border)', flexShrink:0 }} />

      {/* Timers */}
      {[
        { label:'PAUSE', start: pauseStart, running: isPaused, color: isPaused ? 'var(--orange)' : 'var(--text2)' },
        { label:'CALL',  start: callState?.answered_at, running: isOnCall, color: isOnCall ? 'var(--coral)' : 'var(--text2)' },
        { label:'DISPO', start: callState?.status === 'ended' ? callState?.ended_at : null, running: callState?.status === 'ended', color: callState?.status === 'ended' ? 'var(--purple)' : 'var(--text2)' }
      ].map(t => (
        <div key={t.label} style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'0 10px', borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:8, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--purple)', marginBottom:1 }}>{t.label}</div>
          <Timer start={t.start} running={t.running} color={t.color} size={12} />
        </div>
      ))}

      {/* Right */}
      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
        <Clock />
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', background:'rgba(124,58,237,0.08)', border:'2px solid rgba(124,58,237,0.2)', borderRadius:100, fontSize:11, fontWeight:700 }}>
          <span style={{ color:'var(--text2)' }}>Queue</span>
          <span style={{ color:'var(--purple)', fontFamily:'var(--mono)' }}>{callsInQueue || 0}</span>
        </div>
        <div style={{
          padding:'5px 12px', borderRadius:100, fontSize:11, fontWeight:800, textTransform:'uppercase',
          background: hasCall ? 'rgba(255,95,109,0.12)' : 'rgba(16,185,129,0.08)',
          color: hasCall ? 'var(--coral)' : 'var(--green)',
          border: `2px solid ${hasCall ? 'rgba(255,95,109,0.3)' : 'rgba(16,185,129,0.25)'}`,
        }}>
          {hasCall ? '● LIVE CALL' : 'No Call'}
        </div>
        <span style={{ fontSize:12, color:'var(--text2)', fontWeight:700 }}>{user?.full_name || user?.username}</span>
        <button className="btn btn-ghost btn-sm" onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
}