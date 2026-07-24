import React, { useState, useEffect } from 'react';
import { makeCall, playDTMFTone } from '../services/sipClient';

const KEYS = [['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['*',''],['0','+'],['#','']];

function useTimer(start) {
  const [e, setE] = useState(0);
  useEffect(() => {
    if (!start) { setE(0); return; }
    setE(Math.floor((Date.now() - new Date(start).getTime()) / 1000));
    const iv = setInterval(() => setE(Math.floor((Date.now() - new Date(start).getTime()) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [start]);
  const h = Math.floor(e/3600), m = Math.floor((e%3600)/60), s = e%60;
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

export default function WebPhone({ sipStatus, callState, sipConfig, isMuted, isOnHold, incomingSession, onAnswer, onHangup, onMute, onHold, onDTMF }) {
  const [num, setNum] = useState('');
  const timer = useTimer(callState?.answered_at);
  const hasCall = callState && ['ringing','answered'].includes(callState.status);
  const isAnswered = callState?.status === 'answered';
  const isIncoming = callState?.incoming && !isAnswered;
  const isRinging  = callState?.status === 'ringing' && !isIncoming;

  const sipColors = { registered:'var(--green)', registering:'var(--yellow)', failed:'var(--red)', disconnected:'var(--text2)' };
  const sipLabel  = { registered:'ACTIVE', registering:'CONNECTING', failed:'FAILED', disconnected:'OFFLINE' };

  const handleKey = d => {
    playDTMFTone(d); // local beep
    if (isAnswered) { onDTMF(d); return; }
    setNum(n => n + d);
  };

  return (
    <div className="panel" style={{ flex:'0 0 auto', borderRight:'none', background:'var(--bg-app)' }}>
      <div className="panel-hdr panel-hdr-orange" style={{ justifyContent:'space-between' }}>
        <span>Web Phone</span>
        <span className={`sip-pill ${sipStatus}`} style={{ fontSize:9 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background: sipColors[sipStatus]||'var(--text2)', display:'inline-block', boxShadow: sipStatus==='registered'?'0 0 6px var(--green)':'none', animation: sipStatus==='registering'?'blink 1s infinite':undefined }} />
          {sipLabel[sipStatus]||'OFFLINE'}
        </span>
      </div>

      <div className="panel-body" style={{ padding:10 }}>
        {/* Call display */}
        <div className={`call-box ${isAnswered?'oncall':isRinging?'ringing':isIncoming?'incoming':''}`} style={{ marginBottom:10, minHeight:100 }}>
          {isIncoming ? (
            <>
              <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--green)', marginBottom:8 }}>
                <span className="ringing-icon" style={{ display:'inline-block' }}>📞</span> INCOMING CALL
              </div>
              <div className="call-number" style={{ fontSize:18 }}>{callState?.caller_id||'Unknown'}</div>
              {callState?.caller_name && <div style={{ fontSize:11, color:'var(--text2)', marginTop:3 }}>{callState.caller_name}</div>}
            </>
          ) : isAnswered ? (
            <>
              <div style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--red)', marginBottom:4 }}>● ON CALL</div>
              <div className="call-number" style={{ fontSize:16 }}>{callState?.caller_id||'—'}</div>
              <div className="call-timer-lg">{timer}</div>
            </>
          ) : isRinging ? (
            <>
              <div style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'var(--yellow)', marginBottom:8 }}>◌ RINGING</div>
              <div className="call-number" style={{ fontSize:16 }}>{callState?.caller_id||'—'}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize:28, opacity:0.15, marginBottom:6 }}>📞</div>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600 }}>NO LIVE CALL</div>
              {sipConfig && <div style={{ fontSize:10, color:'var(--muted)', marginTop:4, fontFamily:'var(--mono)' }}>EXT {sipConfig.username}</div>}
            </>
          )}
        </div>

        {/* Main action button */}
        <div style={{ display:'flex', gap:8, justifyContent:'center', marginBottom:10 }}>
          {isIncoming && (
            <button className="btn btn-green btn-circle" onClick={onAnswer} style={{ boxShadow:'0 0 20px var(--green-glow)' }}>📞</button>
          )}
          {hasCall && (
            <button className="btn btn-red btn-circle" onClick={onHangup} style={{ boxShadow:'0 0 20px var(--red-glow)' }}>✕</button>
          )}
          {!hasCall && num && (
            <button className="btn btn-green btn-circle" onClick={() => makeCall(num, sipConfig)} style={{ boxShadow:'0 0 20px var(--green-glow)' }}>📞</button>
          )}
        </div>

        {/* In-call controls */}
        {isAnswered && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5, marginBottom:10 }}>
            <button className={`ctrl ${isMuted?'active':''}`} onClick={onMute}>
              {isMuted ? '🔇 UNMUTE' : '🎙 MUTE'}
            </button>
            <button className={`ctrl ${isOnHold?'active':''}`} onClick={onHold}>
              {isOnHold ? '▶ UNHOLD' : '⏸ HOLD'}
            </button>
          </div>
        )}

        {/* Number input */}
        {!hasCall && (
          <div style={{ display:'flex', gap:5, marginBottom:8 }}>
            <input className="inp" style={{ flex:1, fontFamily:'var(--mono)', textAlign:'center', letterSpacing:2, fontSize:14 }}
              value={num} onChange={e => setNum(e.target.value.replace(/[^0-9*#+]/g,''))}
              onKeyDown={e => e.key==='Enter' && num && makeCall(num, sipConfig)}
              placeholder="Manual dial..." />
            {num && <button className="btn btn-ghost btn-sq" onClick={() => setNum(n => n.slice(0,-1))}>⌫</button>}
          </div>
        )}

        {/* Dialpad */}
        <div className="dialpad">
          {KEYS.map(([d,s]) => (
            <div key={d} className="dk" onClick={() => handleKey(d)}>
              <span className="dk-n">{d}</span>
              {s && <span className="dk-s">{s}</span>}
            </div>
          ))}
        </div>

        {/* Status footer */}
        <div style={{ marginTop:10, padding:'6px 8px', background:'var(--bg-input)', borderRadius:'var(--r)', border:'1px solid var(--border-dim)', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10 }}>
          <span style={{ color:'var(--muted)' }}>SIP</span>
          <span style={{ color: sipColors[sipStatus]||'var(--text2)', fontWeight:700 }}>{sipLabel[sipStatus]||'OFFLINE'}</span>
        </div>
      </div>
    </div>
  );
}
