import React, { useState, useEffect, useCallback } from 'react';
import { bookedAPI } from '../services/api';

// Agent's own booked leads (calls dispositioned as Sale/Appointment) with the
// admin's review status + comment. Opens like the Callbacks panel — a left-panel
// trigger + a slide-in popup with Today/Yesterday/This Week/This Month filters.
const PERIODS = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' }
];

function fmtTime(str) {
  if (!str) return '';
  try { return new Date(str).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function statusMeta(s) {
  if (s === 'accepted')  return { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)', icon: '✓' };
  if (s === 'cancelled') return { label: 'Declined', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', icon: '✗' };
  return { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', icon: '🕐' };
}

export default function BookedLeads({ user }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState('today');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { const data = await bookedAPI.mine(period); setList(Array.isArray(data) ? data : []); }
    catch { setList([]); }
    finally { setLoading(false); }
  }, [period]);

  // Badge = today's booking count; refreshed on mount + periodically.
  const loadCount = useCallback(async () => {
    try { const data = await bookedAPI.mine('today'); setCount(Array.isArray(data) ? data.length : 0); } catch {}
  }, []);

  useEffect(() => {
    if (!user) return;
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, [user, loadCount]);

  useEffect(() => { if (open) load(); }, [open, period, load]);
  // Light poll while open so an admin's approve/decline shows up without reopening.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [open, load]);

  return (
    <>
      {/* Left-panel trigger */}
      <button className="ctrl" onClick={() => setOpen(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>📋 Booked Leads</span>
        <span style={{ background: count > 0 ? '#10b981' : 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 100, padding: '1px 8px', fontSize: 11, fontWeight: 900, minWidth: 18, textAlign: 'center' }}>{count}</span>
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', justifyContent: 'flex-end' }}
          onClick={e => e.target === e.currentTarget && setOpen(false)}>
          <style>{`@keyframes bkSlideIn{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}`}</style>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(30,18,72,0.35)', backdropFilter: 'blur(4px)' }} onClick={() => setOpen(false)} />
          <div style={{ position: 'relative', zIndex: 1, width: 420, maxWidth: '100vw', height: '100vh', background: '#fff', boxShadow: '-12px 0 48px rgba(124,58,237,0.2)', display: 'flex', flexDirection: 'column', animation: 'bkSlideIn 0.25s ease' }}>
            {/* Header */}
            <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg,#7c3aed,#6366f1)', color: '#fff', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.5px' }}>📋 Booked Leads</div>
                <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 10, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: '#fff' }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PERIODS.map(p => (
                  <button key={p.key} onClick={() => setPeriod(p.key)} style={{
                    padding: '5px 12px', borderRadius: 100, cursor: 'pointer', fontSize: 11, fontWeight: 800,
                    border: '2px solid ' + (period === p.key ? '#fff' : 'rgba(255,255,255,0.3)'),
                    background: period === p.key ? '#fff' : 'transparent',
                    color: period === p.key ? '#7c3aed' : '#fff'
                  }}>{p.label}</button>
                ))}
              </div>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflow: 'auto', background: '#f7f7fb' }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#888', fontSize: 14 }}>Loading…</div>
              ) : list.length === 0 ? (
                <div style={{ padding: 50, textAlign: 'center' }}>
                  <div style={{ fontSize: 50, opacity: 0.2, marginBottom: 10 }}>📋</div>
                  <div style={{ fontWeight: 800, color: '#333' }}>No booked leads</div>
                  <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Sales you book will appear here.</div>
                </div>
              ) : list.map(b => {
                const name = [b.first_name, b.last_name].filter(Boolean).join(' ') || 'Unknown';
                const st = statusMeta(b.appointment_status);
                return (
                  <div key={b.id} style={{ padding: '13px 18px', borderBottom: '1px solid #e8e8f0', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>{b.phone}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#222', marginTop: 2 }}>{name}</div>
                        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>🕐 {fmtTime(b.called_at)}{b.campaign_name ? ` · ${b.campaign_name}` : ''}</div>
                      </div>
                      <span style={{ flexShrink: 0, padding: '3px 10px', borderRadius: 100, fontSize: 11, fontWeight: 800, color: st.color, background: st.bg, border: `2px solid ${st.border}` }}>{st.icon} {st.label}</span>
                    </div>
                    {b.appointment_note && b.appointment_status !== 'pending' && (
                      <div style={{ marginTop: 8, padding: '8px 11px', borderRadius: 8, background: st.bg, borderLeft: `3px solid ${st.color}`, fontSize: 12, color: '#333', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 800, color: st.color }}>Admin note: </span>{b.appointment_note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}