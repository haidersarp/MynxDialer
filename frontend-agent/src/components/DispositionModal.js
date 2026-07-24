import React, { useState, useEffect } from 'react';

// ── Calendar / datetime picker ─────────────────────────────────────────────────
function CalendarPicker({ value, onChange }) {
  const now   = new Date();
  const [view, setView]       = useState('quick'); // 'quick' | 'calendar'
  const [selDate, setSelDate] = useState('');
  const [selTime, setSelTime] = useState('09:00');
  const [month, setMonth]     = useState(now.getMonth());
  const [year, setYear]       = useState(now.getFullYear());

  // Convert date to LOCAL ISO string (not UTC) for correct timezone display
  function toLocalISO(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const quickOptions = [
    { label: 'In 1 hour',       icon: '⏰', fn: () => { const d = new Date(); d.setMinutes(d.getMinutes() + 60, 0, 0); onChange(toLocalISO(d)); } },
    { label: 'In 3 hours',      icon: '⏰', fn: () => { const d = new Date(); d.setMinutes(d.getMinutes() + 180, 0, 0); onChange(toLocalISO(d)); } },
    { label: 'Today 5 PM',      icon: '📌', fn: () => { const d = new Date(); d.setHours(17, 0, 0, 0); onChange(toLocalISO(d)); } },
    { label: 'Tomorrow 9 AM',   icon: '📅', fn: () => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); onChange(toLocalISO(d)); } },
    { label: 'Tomorrow 2 PM',   icon: '📅', fn: () => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(14,0,0,0); onChange(toLocalISO(d)); } },
    { label: 'Next Monday 9 AM',icon: '📆', fn: () => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + ((8-day)%7||7)); d.setHours(9,0,0,0); onChange(toLocalISO(d)); } },
  ];

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay    = new Date(year, month, 1).getDay();
  const months      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days        = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  const handleCalendarDay = (d) => {
    const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    setSelDate(dateStr);
    onChange(`${dateStr}T${selTime}`);
    setView('quick'); // jump back to show confirmation
  };

  const handleTimeChange = (t) => {
    setSelTime(t);
    if (selDate) onChange(`${selDate}T${t}`);
  };

  const selectedDate = value ? value.slice(0, 10) : '';
  // Parse the LOCAL iso string directly (avoid UTC conversion)
  const label = value
    ? (() => {
        const [datePart, timePart] = value.split('T');
        const [y,m,d] = datePart.split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${d} ${months[parseInt(m)-1]}, ${timePart?.slice(0,5) || ''}`;
      })()
    : null;

  return (
    <div>
      {/* Current value display */}
      {label && (
        <div style={{ marginBottom: 10, padding: '8px 14px', background: 'linear-gradient(135deg,rgba(124,58,237,0.1),rgba(99,102,241,0.07))', borderRadius: 10, border: '2px solid rgba(124,58,237,0.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--purple)', marginBottom: 2 }}>Scheduled For</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>📅 {label}</div>
          </div>
          <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text2)' }}>✕</button>
        </div>
      )}

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {[['quick','⚡ Quick Select'],['calendar','📅 Calendar']].map(([v,l]) => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, height: 32, borderRadius: 100, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
            background: view === v ? 'linear-gradient(135deg,var(--purple),var(--indigo))' : 'var(--bg-input)',
            color: view === v ? '#fff' : 'var(--text2)',
            boxShadow: view === v ? '0 4px 12px rgba(124,58,237,0.3)' : 'none',
            transition: 'all 0.2s'
          }}>
            {l}
          </button>
        ))}
      </div>

      {/* Quick select */}
      {view === 'quick' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {quickOptions.map(opt => (
            <button key={opt.label} onClick={opt.fn} style={{
              padding: '10px 12px', borderRadius: 10, border: '2px solid var(--border)',
              background: 'var(--bg-input)', cursor: 'pointer', textAlign: 'left',
              fontSize: 12, fontWeight: 600, color: 'var(--text)',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 7
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--purple)'; e.currentTarget.style.background = 'rgba(124,58,237,0.06)'; e.currentTarget.style.color = 'var(--purple)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-input)'; e.currentTarget.style.color = 'var(--text)'; }}
            >
              <span style={{ fontSize: 16 }}>
                {opt.label.includes('hour') ? '⏰' : opt.label.includes('Today') ? '📌' : opt.label.includes('Monday') ? '📆' : '📅'}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Calendar view */}
      {view === 'calendar' && (
        <div style={{ background: 'var(--bg-input)', borderRadius: 14, border: '2px solid var(--border)', padding: 14 }}>
          {/* Month nav */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
              style={{ background: 'none', border: '2px solid var(--border)', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>‹</button>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{months[month]} {year}</span>
            <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
              style={{ background: 'none', border: '2px solid var(--border)', borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 6 }}>
            {days.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--text2)', padding: '4px 0' }}>{d}</div>)}
          </div>

          {/* Days grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
            {Array(firstDay).fill(null).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
              const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const isToday = dateStr === now.toISOString().slice(0, 10);
              const isSel   = dateStr === selectedDate;
              const isPast  = new Date(dateStr) < new Date(now.toISOString().slice(0, 10));
              return (
                <button key={d} onClick={() => !isPast && handleCalendarDay(d)} disabled={isPast} style={{
                  height: 30, borderRadius: 8, border: 'none', cursor: isPast ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: isSel ? 800 : isToday ? 700 : 500,
                  background: isSel ? 'linear-gradient(135deg,var(--purple),var(--indigo))' : isToday ? 'rgba(124,58,237,0.12)' : 'transparent',
                  color: isSel ? '#fff' : isPast ? 'var(--muted)' : isToday ? 'var(--purple)' : 'var(--text)',
                  boxShadow: isSel ? '0 4px 10px rgba(124,58,237,0.3)' : 'none',
                  transition: 'all 0.15s'
                }}>
                  {d}
                </button>
              );
            })}
          </div>

          {/* Time picker */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '2px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>🕐 Time:</span>
            <input type="time" value={selTime} onChange={e => handleTimeChange(e.target.value)}
              style={{ flex: 1, height: 34, borderRadius: 10, border: '2px solid var(--border)', background: '#fff', padding: '0 10px', fontSize: 14, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', cursor: 'pointer' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Disposition Modal ──────────────────────────────────────────────────────────
export default function DispositionModal({ dispositions, onSubmit, onPause, onClose }) {
  const [selected, setSelected]         = useState(null);
  const [notes, setNotes]               = useState('');
  const [callbackAt, setCallbackAt]     = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [pauseAfter, setPauseAfter]     = useState(false);
  const [pauseCodeId, setPauseCodeId]   = useState('');
  const [pauseCodes, setPauseCodes]     = useState([]);
  const [showPauseNow, setShowPauseNow] = useState(false);
  const [pauseNowCode, setPauseNowCode] = useState('');

  useEffect(() => {
    fetch('/api/admin/pause-codes', {
      headers: { Authorization: `Bearer ${localStorage.getItem('agent_token')}` }
    }).then(r => r.json()).then(d => {
      setPauseCodes(d || []);
      if (d?.length) { setPauseCodeId(d[0].id); setPauseNowCode(d[0].id); }
    }).catch(() => {});
  }, []);

  const handleSubmit = async (disp) => {
    const d = disp || selected;
    if (!d) return;
    if (d.is_callback && !callbackAt) { setSelected(d); return; }
    setSubmitting(true);
    try {
      await onSubmit(d.id, notes, d.is_callback ? callbackAt : null, pauseAfter ? pauseCodeId : null);
    } finally { setSubmitting(false); }
  };

  const handleDoubleClick = (disp) => { setSelected(disp); handleSubmit(disp); };

  const handlePauseNow = async () => {
    if (onPause) await onPause(pauseNowCode);
    onClose();
  };

  return (
    <div className="dispo-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="dispo-modal">

        <div className="dispo-modal-header">
          <span>Hangup &amp; Disposition</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text2)', cursor:'pointer', fontSize:18 }}>✕</button>
        </div>

        <div style={{ padding: 16 }}>
          {/* Disposition grid */}
          <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text2)', marginBottom:8 }}>
            Select Disposition
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:6 }}>
            {dispositions.map(d => (
              <button key={d.id} className={`dispo-btn ${selected?.id === d.id ? 'selected' : ''}`}
                disabled={submitting}
                onClick={() => setSelected(d)} onDoubleClick={() => handleDoubleClick(d)}
                title="Click to select · Double-click to instantly commit">
                <div style={{ width:12, height:12, borderRadius:'50%', background:d.color, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>{d.label}</div>
                  <div style={{ display:'flex', gap:4, marginTop:2 }}>
                    {d.is_sale        && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:100, background:'rgba(16,185,129,0.15)', color:'var(--green)', fontWeight:800 }}>SALE</span>}
                    {d.is_dnc         && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:100, background:'rgba(239,68,68,0.15)', color:'var(--red)', fontWeight:800 }}>DNC</span>}
                    {d.is_callback    && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:100, background:'rgba(245,158,11,0.15)', color:'var(--orange)', fontWeight:800 }}>CALLBACK</span>}
                    {d.is_appointment && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:100, background:'rgba(124,58,237,0.15)', color:'var(--purple)', fontWeight:800 }}>APPT</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ fontSize:10, color:'var(--text2)', textAlign:'center', marginBottom:14 }}>
            Single click to select · <strong style={{ color:'var(--purple)' }}>Double-click to instantly commit</strong>
          </div>

          {/* ── Calendar picker for callback ── */}
          {selected?.is_callback && (
            <div style={{ marginBottom:16, padding:'14px 16px', background:'rgba(124,58,237,0.04)', borderRadius:14, border:'2px solid rgba(124,58,237,0.2)' }}>
              <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--purple)', marginBottom:12 }}>
                📅 Callback Date &amp; Time
              </div>
              <CalendarPicker value={callbackAt} onChange={setCallbackAt} />
            </div>
          )}

          {/* Notes */}
          <div style={{ marginBottom:14 }}>
            <div className="lbl" style={{ marginBottom:5 }}>Notes / Comments</div>
            <textarea className="ta" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add call notes..." />
          </div>

          {/* Pause after dispo */}
          <div style={{ padding:'12px 14px', background:'rgba(124,58,237,0.04)', border:'2px solid rgba(124,58,237,0.15)', borderRadius:12, marginBottom:16 }}>
            <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
              <input type="checkbox" checked={pauseAfter} onChange={e => setPauseAfter(e.target.checked)} style={{ width:16, height:16, accentColor:'var(--purple)', cursor:'pointer' }} />
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>⏸ Pause agent after this disposition</div>
                <div style={{ fontSize:11, color:'var(--text2)', marginTop:2 }}>Agent will pause instead of going available</div>
              </div>
            </label>
            {pauseAfter && pauseCodes.length > 0 && (
              <div style={{ marginTop:10 }}>
                <div className="lbl" style={{ marginBottom:5 }}>Pause Reason</div>
                <select className="sel" value={pauseCodeId} onChange={e => setPauseCodeId(e.target.value)}>
                  {pauseCodes.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-red btn-lg" style={{ flex:1 }}
              onClick={() => handleSubmit()}
              disabled={!selected || submitting || (selected?.is_callback && !callbackAt)}>
              {submitting ? 'Saving...' : selected ? `COMMIT: ${selected.label}` : 'SELECT DISPOSITION'}
            </button>

            {/* Pause Now */}
            <div style={{ position:'relative' }}>
              <button className="btn btn-lg" style={{ background:'linear-gradient(135deg,rgba(245,158,11,0.15),rgba(249,115,22,0.1))', border:'2px solid rgba(245,158,11,0.35)', color:'var(--orange)', whiteSpace:'nowrap' }}
                onClick={() => setShowPauseNow(!showPauseNow)}>
                ⏸ PAUSE NOW
              </button>
              {showPauseNow && (
                <div style={{ position:'absolute', bottom:'110%', right:0, background:'#fff', border:'2px solid var(--border)', borderRadius:14, padding:14, minWidth:210, boxShadow:'0 16px 40px rgba(124,58,237,0.2)', zIndex:10 }}>
                  <div className="lbl" style={{ marginBottom:7 }}>Pause Reason</div>
                  <select className="sel" style={{ marginBottom:10 }} value={pauseNowCode} onChange={e => setPauseNowCode(e.target.value)}>
                    {pauseCodes.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <button className="btn btn-orange" style={{ width:'100%' }} onClick={handlePauseNow}>
                    Hang up &amp; Pause
                  </button>
                </div>
              )}
            </div>

            <button className="btn btn-ghost btn-lg" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}