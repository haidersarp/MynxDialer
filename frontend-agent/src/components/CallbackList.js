import React, { useState, useEffect, useCallback } from 'react';
import { callbacksAPI } from '../services/api';
import { makeCall } from '../services/sipClient';

function timeLabel(str) {
  if (!str) return { label: '—', overdue: false };
  const d   = new Date(str);
  const now = new Date();
  const ms  = d - now;
  const abs = Math.abs(ms);
  const m   = Math.floor(abs / 60000);
  const h   = Math.floor(abs / 3600000);
  const dy  = Math.floor(abs / 86400000);
  if (ms < -60000)   return { label: h < 24 ? `${h}h overdue` : `${dy}d overdue`, overdue: true };
  if (ms < 0)        return { label: 'Now!', overdue: true, now: true };
  if (m < 60)        return { label: `in ${m}m`, overdue: false };
  if (h  < 24)       return { label: `in ${h}h`, overdue: false };
  const [dt, tm] = str.split('T');
  const [,mo,day] = (dt||'').split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return { label: `${day} ${months[parseInt(mo)-1]} ${tm?.slice(0,5)}`, overdue: false };
}

function fmtDate(str) {
  if (!str) return '—';
  const [dt, tm] = str.split('T');
  const [y, mo, day] = (dt||'').split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day} ${months[parseInt(mo)-1]} ${y}  ${tm?.slice(0,5)||''}`;
}

// Full detail modal
function DetailModal({ cb, onClose, onCall, onDismiss }) {
  const name = [cb.first_name, cb.last_name].filter(Boolean).join(' ') || 'Unknown';
  const time = timeLabel(cb.scheduled_at);
  const cf   = (() => { try { return JSON.parse(cb.custom_fields||'{}'); } catch { return {}; } })();

  return (
    <div style={{ position:'fixed', inset:0, zIndex:4000, background:'rgba(30,18,72,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:20, backdropFilter:'blur(10px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:20, width:460, maxHeight:'88vh', overflow:'auto', boxShadow:'0 32px 80px rgba(124,58,237,0.3)' }}>
        <div style={{ padding:'18px 20px', background:'linear-gradient(135deg,#7c3aed,#ec4899)', borderRadius:'18px 18px 0 0' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', color:'rgba(255,255,255,0.7)', marginBottom:3 }}>📞 Callback</div>
              <div style={{ fontSize:20, fontWeight:900, color:'#fff' }}>{name}</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:20, fontWeight:700, color:'rgba(255,255,255,0.9)', letterSpacing:2, marginTop:3 }}>{cb.phone}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ padding:'4px 12px', borderRadius:100, fontSize:11, fontWeight:800, background: time.overdue?'rgba(239,68,68,0.35)':'rgba(255,255,255,0.2)', color:time.overdue?'#fca5a5':'#fff', border:`2px solid ${time.overdue?'rgba(239,68,68,0.5)':'rgba(255,255,255,0.35)'}`, marginBottom:4 }}>
                {time.overdue?'🔴':'🕐'} {time.label}
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.65)' }}>{fmtDate(cb.scheduled_at)}</div>
            </div>
          </div>
        </div>
        <div style={{ padding:20 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px 20px', marginBottom:16 }}>
            {[['Campaign',cb.campaign_name],['Previous Calls',cb.call_count||0],['Last Dispo.',cb.last_disposition],['Email',cb.email],['Location',[cb.city,cb.state].filter(Boolean).join(', ')]].filter(([,v])=>v).map(([l,v])=>(
              <div key={l}><div style={{ fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.07em',color:'var(--text2)',marginBottom:2 }}>{l}</div><div style={{ fontSize:13,fontWeight:600,color:'var(--text)' }}>{v}</div></div>
            ))}
          </div>
          {cb.notes && <div style={{ marginBottom:16,padding:'12px 14px',background:'rgba(124,58,237,0.06)',borderRadius:10,borderLeft:'3px solid var(--purple)' }}>
            <div style={{ fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--purple)',marginBottom:6 }}>📝 Notes</div>
            <div style={{ fontSize:13,color:'var(--text)',lineHeight:1.6 }}>{cb.notes}</div>
          </div>}
          {Object.keys(cf).length>0 && <div style={{ marginBottom:16,padding:'10px 14px',background:'var(--bg-input)',borderRadius:10,border:'2px solid var(--border)' }}>
            <div style={{ fontSize:9,fontWeight:800,textTransform:'uppercase',color:'var(--text2)',marginBottom:8 }}>Additional Info</div>
            <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 16px' }}>
              {Object.entries(cf).filter(([,v])=>v).slice(0,8).map(([k,v])=>(
                <div key={k} style={{ fontSize:12 }}><span style={{ color:'var(--text2)',textTransform:'capitalize' }}>{k.replace(/_/g,' ')}: </span><span style={{ color:'var(--text)',fontWeight:600 }}>{v}</span></div>
              ))}
            </div>
          </div>}
          <div style={{ display:'flex',gap:10 }}>
            <button onClick={()=>onCall(cb)} style={{ flex:1,height:46,borderRadius:100,border:'none',cursor:'pointer',background:'linear-gradient(135deg,#10b981,#06b6d4)',color:'#fff',fontSize:14,fontWeight:800,boxShadow:'0 6px 18px rgba(16,185,129,0.4)',transition:'all 0.2s' }}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 10px 24px rgba(16,185,129,0.5)'}}
              onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 6px 18px rgba(16,185,129,0.4)'}}>
              📞 CALL NOW
            </button>
            <button onClick={()=>onDismiss(cb.id)} style={{ height:46,padding:'0 18px',borderRadius:100,border:'2px solid rgba(239,68,68,0.3)',background:'rgba(239,68,68,0.06)',color:'#dc2626',fontSize:13,fontWeight:700,cursor:'pointer' }}>🗑</button>
            <button onClick={onClose} style={{ height:46,padding:'0 16px',borderRadius:100,border:'2px solid var(--border)',background:'transparent',color:'var(--text2)',fontSize:13,fontWeight:600,cursor:'pointer' }}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CallbackList({ sipConfig, refreshTrigger }) {
  const [callbacks, setCallbacks] = useState([]);
  const [total, setTotal]         = useState(0);
  const [overdue, setOverdue]     = useState(0);
  const [open, setOpen]           = useState(false);
  const [detail, setDetail]       = useState(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await callbacksAPI.list({ status:'pending', limit:100 });
      const cbs  = data.callbacks || [];
      setCallbacks(cbs);
      setTotal(data.total || 0);
      setOverdue(cbs.filter(c => new Date(c.scheduled_at) <= new Date()).length);
    } catch(err) {
      console.error('[Callbacks] load error:', err);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const iv = setInterval(load, 20000); return () => clearInterval(iv); }, [load]);
  useEffect(() => { if (refreshTrigger > 0) { setTimeout(load, 1000); } }, [refreshTrigger, load]);

  const handleCall = (cb) => {
    makeCall(cb.phone, sipConfig);
    callbacksAPI.setStatus(cb.id, 'completed').catch(()=>{});
    setCallbacks(p => p.filter(c => c.id !== cb.id));
    setTotal(t => Math.max(0,t-1));
    setDetail(null); setOpen(false);
  };

  const handleDismiss = async (id) => {
    await callbacksAPI.setStatus(id, 'missed').catch(()=>{});
    setCallbacks(p => p.filter(c => c.id !== id));
    setTotal(t => Math.max(0,t-1));
    setDetail(null);
  };

  const tabBg = overdue > 0
    ? 'linear-gradient(135deg,#ef4444,#ec4899)'
    : total > 0 ? 'linear-gradient(135deg,#f59e0b,#f97316)'
    : 'linear-gradient(135deg,#10b981,#06b6d4)';

  return (
    <>
      {/* ── Fixed tab at bottom-right ── */}
      <div onClick={() => setOpen(true)} style={{
        padding:'11px 16px', flexShrink:0, cursor:'pointer',
        background: tabBg, color:'#fff',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        userSelect:'none', transition:'all 0.2s',
      }}
        onMouseEnter={e => e.currentTarget.style.filter='brightness(1.1)'}
        onMouseLeave={e => e.currentTarget.style.filter='none'}
      >
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:15 }}>⏰</span>
          <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em' }}>Callbacks</span>
          {total > 0 && (
            <span style={{ background:'rgba(255,255,255,0.3)', color:'#fff', borderRadius:100, padding:'2px 9px', fontSize:12, fontWeight:900 }}>{total}</span>
          )}
          {overdue > 0 && (
            <span style={{ background:'#fff', color:'#dc2626', borderRadius:100, padding:'2px 9px', fontSize:10, fontWeight:900 }}>⚡ {overdue} OVERDUE</span>
          )}
        </div>
        <span style={{ fontSize:12, opacity:0.8 }}>▲ Open</span>
      </div>

      {/* ── Full-screen overlay popup ── */}
      {open && (
        <div style={{ position:'fixed', inset:0, zIndex:3000, display:'flex', alignItems:'flex-end', justifyContent:'flex-end' }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}>

          {/* Dimmed backdrop */}
          <div style={{ position:'absolute', inset:0, background:'rgba(30,18,72,0.3)', backdropFilter:'blur(4px)' }} onClick={() => setOpen(false)} />

          {/* Popup panel sliding from right */}
          <div style={{
            position:'relative', zIndex:1,
            width:400, height:'100vh',
            background:'#fff',
            boxShadow:'-12px 0 48px rgba(124,58,237,0.2)',
            display:'flex', flexDirection:'column',
            animation:'slideInRight 0.25s cubic-bezier(.34,1.56,.64,1)',
          }}>
            {/* Header */}
            <div style={{ padding:'18px 20px', background:'linear-gradient(135deg,#7c3aed,#6366f1)', color:'#fff', flexShrink:0 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div style={{ fontSize:18, fontWeight:900, letterSpacing:'-0.5px' }}>⏰ Callbacks</div>
                <button onClick={() => setOpen(false)} style={{ background:'rgba(255,255,255,0.2)', border:'none', borderRadius:10, width:32, height:32, cursor:'pointer', fontSize:16, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:12, color:'rgba(255,255,255,0.75)', fontWeight:600 }}>{total} pending</span>
                {overdue > 0 && <span style={{ background:'rgba(239,68,68,0.3)', color:'#fca5a5', borderRadius:100, padding:'2px 10px', fontSize:11, fontWeight:800, border:'1px solid rgba(239,68,68,0.4)' }}>🔴 {overdue} overdue</span>}
                <button onClick={load} style={{ marginLeft:'auto', background:'rgba(255,255,255,0.15)', border:'none', borderRadius:8, padding:'4px 10px', cursor:'pointer', color:'#fff', fontSize:11, fontWeight:700 }}>↻ Refresh</button>
              </div>
            </div>

            {/* Callback list */}
            <div style={{ flex:1, overflow:'auto' }}>
              {loading ? (
                <div style={{ padding:50, textAlign:'center', color:'var(--text2)', fontSize:14 }}>Loading...</div>
              ) : callbacks.length === 0 ? (
                <div style={{ padding:50, textAlign:'center' }}>
                  <div style={{ fontSize:56, marginBottom:12, opacity:0.2 }}>📭</div>
                  <div style={{ fontSize:16, fontWeight:800, color:'var(--text)', marginBottom:6 }}>No pending callbacks</div>
                  <div style={{ fontSize:13, color:'var(--text2)' }}>When you set a callback during a call,<br/>it will appear here</div>
                </div>
              ) : callbacks.map(cb => {
                const name = [cb.first_name, cb.last_name].filter(Boolean).join(' ') || 'Unknown';
                const time = timeLabel(cb.scheduled_at);

                return (
                  <div key={cb.id} style={{ padding:'14px 18px', borderBottom:'2px solid var(--border)', background: time.overdue?'rgba(239,68,68,0.03)':'#fff' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                      {/* Info */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                          <div style={{ width:9, height:9, borderRadius:'50%', background:time.overdue?'#ef4444':'#f59e0b', flexShrink:0, boxShadow:time.overdue?'0 0 0 3px rgba(239,68,68,0.2)':'0 0 0 3px rgba(245,158,11,0.2)' }} />
                          <span style={{ fontFamily:'var(--mono)', fontSize:16, fontWeight:800, color:'var(--purple)' }}>{cb.phone}</span>
                        </div>
                        <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:3, paddingLeft:17 }}>{name}</div>
                        <div style={{ fontSize:11, color:'var(--text2)', paddingLeft:17, marginBottom:3 }}>📅 {fmtDate(cb.scheduled_at)}</div>
                        {cb.campaign_name && <div style={{ fontSize:11, color:'var(--purple)', paddingLeft:17, fontWeight:600 }}>🎯 {cb.campaign_name}</div>}
                        {cb.notes && <div style={{ fontSize:12, color:'var(--text2)', paddingLeft:17, marginTop:5, padding:'6px 10px 6px 17px', background:'rgba(124,58,237,0.05)', borderRadius:8, borderLeft:'2px solid rgba(124,58,237,0.2)', fontStyle:'italic' }}>💬 {cb.notes}</div>}
                      </div>

                      {/* Time + actions */}
                      <div style={{ display:'flex', flexDirection:'column', gap:6, flexShrink:0, alignItems:'flex-end' }}>
                        <span style={{ fontSize:11, fontWeight:800, color:time.overdue?'#dc2626':'#d97706', padding:'3px 10px', borderRadius:100, background:time.overdue?'rgba(239,68,68,0.1)':'rgba(245,158,11,0.1)', border:`2px solid ${time.overdue?'rgba(239,68,68,0.25)':'rgba(245,158,11,0.25)'}` }}>
                          {time.label}
                        </span>
                        <button onClick={() => handleCall(cb)} style={{
                          height:32, padding:'0 14px', borderRadius:100, border:'none', cursor:'pointer',
                          background:'linear-gradient(135deg,#10b981,#06b6d4)', color:'#fff',
                          fontSize:12, fontWeight:800, letterSpacing:'0.03em',
                          boxShadow:'0 4px 12px rgba(16,185,129,0.35)',
                          transition:'all 0.2s',
                        }}
                          onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 6px 16px rgba(16,185,129,0.45)'}}
                          onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 4px 12px rgba(16,185,129,0.35)'}}
                        >
                          📞 Call Now
                        </button>
                        <button onClick={() => setDetail(cb)} style={{
                          height:28, padding:'0 12px', borderRadius:100,
                          border:'2px solid rgba(124,58,237,0.25)', background:'rgba(124,58,237,0.06)',
                          color:'var(--purple)', fontSize:11, fontWeight:700, cursor:'pointer', transition:'all 0.15s'
                        }}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(124,58,237,0.12)'}
                          onMouseLeave={e=>e.currentTarget.style.background='rgba(124,58,237,0.06)'}
                        >
                          Details →
                        </button>
                        <button onClick={() => handleDismiss(cb.id)} style={{
                          height:26, padding:'0 10px', borderRadius:100,
                          border:'2px solid rgba(239,68,68,0.2)', background:'transparent',
                          color:'#ef4444', fontSize:10, fontWeight:700, cursor:'pointer', transition:'all 0.15s'
                        }}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,0.06)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                        >
                          🗑 Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ padding:'12px 18px', borderTop:'2px solid var(--border)', background:'rgba(124,58,237,0.04)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:12, color:'var(--text2)', fontWeight:600 }}>{total} pending callback{total!==1?'s':''}</span>
              <button onClick={() => setOpen(false)} style={{ height:32, padding:'0 16px', borderRadius:100, border:'2px solid var(--border)', background:'transparent', color:'var(--text2)', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                Close Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && <DetailModal cb={detail} sipConfig={sipConfig} onClose={() => setDetail(null)} onCall={handleCall} onDismiss={handleDismiss} />}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}