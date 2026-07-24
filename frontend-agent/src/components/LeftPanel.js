import React, { useState, useEffect } from 'react';
import { makeCall, transfer } from '../services/sipClient';
import { callsAPI } from '../services/api';
import BookedLeads from './BookedLeads';

function AgentStats({ user }) {
  const [stats, setStats] = useState({ calls: 0, sales: 0, talkTime: 0, avgHandle: 0 });
  useEffect(() => {
    const token = localStorage.getItem('agent_token');
    if (!token || !user) return;
    let active = true;
    // Agent's OWN today stats (agent-accessible, scoped to the logged-in user).
    const load = () => {
      fetch(`/api/reports/my-performance`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!active || !d) return;
          setStats({
            calls:    d.total_calls     || 0,
            sales:    d.sales           || 0,
            talkTime: d.total_talk_time || 0,
            avgHandle:d.avg_duration    || 0
          });
        })
        .catch(() => {});
    };
    load();
    // Keep it synced as the agent works — refresh every 15s.
    const t = setInterval(load, 15000);
    return () => { active = false; clearInterval(t); };
  }, [user]);

  const fmtTime = s => {
    if (!s) return '0:00';
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2,'0')}`;
  };
  const conv = stats.calls > 0 ? ((stats.sales / stats.calls) * 100).toFixed(0) : 0;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
        {[
          { label:'Calls Today', value: stats.calls, color:'var(--cyan)' },
          { label:'Sales', value: stats.sales, color:'var(--green)' },
          { label:'Conv Rate', value: conv + '%', color: parseInt(conv) >= 10 ? 'var(--green)' : 'var(--yellow)' },
          { label:'Avg Handle', value: fmtTime(stats.avgHandle), color:'var(--text)' }
        ].map(s => (
          <div key={s.label} className="stat-mini">
            <div className="stat-mini-label">{s.label}</div>
            <div className="stat-mini-value" style={{ color: s.color, fontSize: 16 }}>{s.value}</div>
          </div>
        ))}
      </div>
      {stats.calls > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'rgba(255,255,255,0.4)', marginBottom:3 }}>
            <span>PROGRESS</span><span>{stats.calls} calls</span>
          </div>
          <div className="perf-bar" style={{ background:'rgba(255,255,255,0.15)' }}>
            <div className="perf-bar-fill" style={{ width: `${Math.min(100, stats.calls * 4)}%`, background: 'linear-gradient(90deg,#a5f3fc,#818cf8)' }} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeftPanel({ user, sipConfig, sipStatus, callState, onHangup }) {
  const [manualDial, setManualDial] = useState('');
  const [transferNum, setTransferNum] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [parking, setParking] = useState(false);
  const [parkLot, setParkLot] = useState(null);

  const hasCall = callState && ['ringing','answered'].includes(callState.status);
  const sipDot = { registered:'var(--green)', registering:'var(--yellow)', failed:'var(--red)', disconnected:'var(--text2)' };

  const handleManualDial = () => { if (manualDial.trim()) { makeCall(manualDial.trim(), sipConfig); setManualDial(''); } };
  const handlePark = async () => {
    if (!callState?.id) return; setParking(true);
    try { const r = await callsAPI.park(callState.id); setParkLot(r.lot || '700'); } catch { alert('Park failed'); }
    finally { setParking(false); }
  };
  const handleTransfer = () => { if (transferNum.trim()) { transfer(transferNum.trim(), sipConfig?.realm); setShowTransfer(false); setTransferNum(''); } };

  return (
    <div className="panel panel-left" style={{ width:185, flexShrink:0, background:'linear-gradient(180deg, #1e1248 0%, #2d1a6e 100%)' }}>
      {/* Extension */}
      <div style={{ padding:'10px 12px', background:'linear-gradient(135deg,#7c3aed,#6366f1)', borderBottom:'none' }}>
        <div style={{ fontSize:9, color:'var(--muted)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>Extension</div>
        <div style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:700, color:'#a5f3fc', marginBottom:6 }}>
          {user?.extension ? `SIP/PJSIP/${user.extension}` : 'Not Configured'}
        </div>
        <span className={`sip-pill ${sipStatus}`}>
          <span style={{ width:5, height:5, borderRadius:'50%', background: sipDot[sipStatus] || 'var(--text2)', display:'inline-block', boxShadow: sipStatus === 'registered' ? '0 0 6px var(--green)' : 'none' }} />
          {sipStatus || 'disconnected'}
        </span>
      </div>

      <div className="panel-body" style={{ padding:'10px 10px', background:'transparent' }}>
        {/* Agent stats */}
        <div className="sec-hdr" style={{ color:'rgba(165,243,252,0.8)' }}>Performance Today</div>
        <AgentStats user={user} />

        {/* Manual Dial */}
        <div className="sec-hdr" style={{ color:'rgba(165,243,252,0.8)' }}>Manual Dial</div>
        <div style={{ marginBottom:10 }}>
          <div style={{ display:'flex', gap:4, marginBottom:5 }}>
            <input className="inp" style={{ flex:1, fontFamily:'var(--mono)', fontSize:13, textAlign:'center', letterSpacing:1 }}
              placeholder="Number..." value={manualDial}
              onChange={e => setManualDial(e.target.value.replace(/[^0-9*#+]/g,''))}
              onKeyDown={e => e.key === 'Enter' && handleManualDial()} />
            {manualDial && <button className="btn btn-ghost btn-sq" onClick={() => setManualDial(d => d.slice(0,-1))}>⌫</button>}
          </div>
          <button className="btn btn-blue" style={{ width:'100%' }} onClick={handleManualDial} disabled={!manualDial}>
            📞 Manual Dial
          </button>
        </div>

        {/* Booked Leads (replaces the DTMF keypad — DTMF kept in code for future use) */}
        <div className="sec-hdr" style={{ color:'rgba(165,243,252,0.8)' }}>Booked Leads</div>
        <div style={{ marginBottom:10 }}>
          <BookedLeads user={user} />
        </div>

        {/* Call Controls */}
        <div className="sec-hdr" style={{ color:'rgba(165,243,252,0.8)' }}>Call Controls</div>
        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
          <button className={`ctrl ${parkLot ? 'active' : ''}`} onClick={handlePark} disabled={!hasCall || parking}>
            📌 {parking ? '...' : parkLot ? `PARKED: LOT ${parkLot}` : 'PARK CALL'}
          </button>
          <button className="ctrl" onClick={() => setShowTransfer(!showTransfer)} disabled={!hasCall}>
            ⇄ TRANSFER — CONF
          </button>
          {showTransfer && (
            <div style={{ display:'flex', gap:4 }}>
              <input className="inp" style={{ flex:1, fontSize:11 }} placeholder="Extension"
                value={transferNum} onChange={e => setTransferNum(e.target.value)} />
              <button className="btn btn-cyan btn-sq" onClick={handleTransfer}>→</button>
            </div>
          )}
          <button className="ctrl danger" onClick={onHangup} disabled={!hasCall}>
            ✕ HANGUP CUSTOMER
          </button>
        </div>

        {/* Keyboard shortcuts */}
        <div style={{ marginTop:14, padding:'8px 10px', background:'var(--bg-input)', borderRadius:'var(--r)', border:'1px solid var(--border-dim)' }}>
          <div style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--muted)', marginBottom:6 }}>Shortcuts</div>
          {[['F1','Answer/Hangup'],['F2','Mute'],['F3','Hold'],['F4','Disposition']].map(([k,v]) => (
            <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text2)', marginBottom:3 }}>
              <kbd style={{ padding:'1px 5px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:3, fontSize:9, color:'var(--cyan)' }}>{k}</kbd>
              <span style={{ color:'var(--muted)' }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
