import React, { useState, useEffect, useCallback } from 'react';
import AudioPlayer from '../components/AudioPlayer';
import api from '../services/api';

const appointmentsAPI = {
  list:  params => api.get('/appointments', { params }),
  stats: () => api.get('/appointments/stats/summary'),
  setStatus: (id, status, note) => api.post(`/appointments/${id}/status`, { status, note }),
  remove: (id) => api.delete(`/appointments/${id}`),
};

function LeadSheet({ appt, onClose }) {
  // custom_fields may arrive already parsed (mysql2 JSON column) OR as a string —
  // JSON.parse on an object throws, which is why nothing was showing before.
  const cf = (() => {
    try { const c = appt.custom_fields; return typeof c === 'string' ? JSON.parse(c || '{}') : (c || {}); }
    catch { return {}; }
  })();
  const fullName = [appt.first_name || cf.Forename || cf.forename || cf.first_name,
                    appt.last_name  || cf.Surname  || cf.surname]
                   .filter(Boolean).join(' ');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20, backdropFilter: 'blur(8px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'linear-gradient(160deg, var(--bg-card), var(--bg-tertiary))', border: '1px solid var(--border-glow)', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 740, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 30px 80px rgba(0,0,0,0.7), 0 0 40px rgba(0,229,255,0.05)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-dim)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'linear-gradient(90deg, rgba(0,229,255,0.06), rgba(41,121,255,0.04))' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ padding: '3px 10px', borderRadius: 4, background: `${appt.disposition_color || '#00e676'}22`, border: `1px solid ${appt.disposition_color || '#00e676'}55`, fontSize: 12, fontWeight: 700, color: appt.disposition_color || 'var(--success)' }}>
                🗓 {appt.disposition_label || 'APPOINTMENT'}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                #{appt.id} · {new Date(appt.called_at).toLocaleString()}
              </span>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>
              {fullName || 'Unknown Lead'}
            </h2>
            <div style={{ fontSize: 16, fontFamily: 'var(--font-mono)', color: 'var(--accent)', letterSpacing: 2, marginTop: 4 }}>
              {appt.phone}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', cursor: 'pointer', width: 32, height: 32, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Agent + Campaign info */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 20, padding: 14, background: 'var(--bg-input)', borderRadius: 'var(--radius)', border: '1px solid var(--border-dim)' }}>
            {[
              { l: 'Agent',     v: appt.agent_name },
              { l: 'Extension', v: appt.agent_extension || '—' },
              { l: 'Campaign',  v: appt.campaign_name },
              { l: 'Duration',  v: appt.duration ? `${Math.floor(appt.duration/60)}:${(appt.duration%60).toString().padStart(2,'0')}` : '—' }
            ].map(f => (
              <div key={f.l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 4 }}>{f.l}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: f.l === 'Extension' ? 'var(--font-mono)' : undefined }}>{f.v || '—'}</div>
              </div>
            ))}
          </div>

          {/* Lead details grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', marginBottom: 20 }}>
            {[
              ['Email', appt.email],
              ['Address', [appt.address, appt.city, appt.state, appt.zip].filter(Boolean).join(', ')],
              ...Object.entries(cf).filter(([, v]) => v).map(([k, v]) => [k.replace(/_/g, ' '), v])
            ].map(([l, v]) => v ? (
              <div key={l}>
                <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', padding: '4px 8px', background: 'var(--bg-input)', borderRadius: 'var(--radius)', border: '1px solid var(--border-dim)' }}>{v}</div>
              </div>
            ) : null)}
          </div>

          {/* Call notes — always shown so it's clear whether the agent left any */}
          <div style={{ marginBottom: 20, padding: 14, background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', marginBottom: 8 }}>Agent Notes</div>
            <div style={{ fontSize: 13, color: appt.notes ? 'var(--text-primary)' : 'var(--text-muted)', lineHeight: 1.6, fontStyle: appt.notes ? 'normal' : 'italic' }}>
              {appt.notes || 'No notes added by the agent for this call.'}
            </div>
          </div>

          {/* Recording */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 10 }}>
              Call Recording {appt.recording_file ? '' : '— Not available (simulation mode or recording disabled)'}
            </div>
            <AudioPlayer callId={appt.recording_file ? appt.id : null} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Appointments() {
  const [appointments, setAppointments] = useState([]);
  const [stats, setStats]               = useState({ accepted: 0, made_today: 0, this_week: 0, cancelled: 0 });
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(null);
  const [noteModal, setNoteModal]       = useState(null);   // { id, status } when accepting/cancelling
  const [noteText, setNoteText]         = useState('');
  const [busy, setBusy]                 = useState(false);
  const today = new Date().toISOString().split('T')[0];
  // Default to TODAY's sales/appointments; the date filter can widen it.
  const [filters, setFilters] = useState({ search: '', date_from: today, date_to: today });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filters.search)    params.search    = filters.search;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to)   params.date_to   = filters.date_to;

      const [data, s] = await Promise.all([
        appointmentsAPI.list(params),
        appointmentsAPI.stats()
      ]);
      setAppointments(data.appointments || []);
      setTotal(data.total || 0);
      setStats(s || {});
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };

  // Accept (✓) / Cancel (✗) — open a note prompt first; the note lands on the lead.
  const openStatus = (id, status) => { setNoteModal({ id, status }); setNoteText(''); };

  const confirmStatus = async () => {
    if (!noteModal) return;
    setBusy(true);
    setAppointments(list => list.map(a => a.id === noteModal.id ? { ...a, appointment_status: noteModal.status } : a));
    try { await appointmentsAPI.setStatus(noteModal.id, noteModal.status, noteText); } catch (_) {}
    setNoteModal(null); setNoteText(''); setBusy(false);
    load();
  };

  // Permanently delete an appointment/sale (with confirmation).
  const handleDelete = async (a) => {
    const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.phone;
    if (!window.confirm(`PERMANENTLY delete this ${a.disposition_label || 'appointment'} for "${name}"?\n\nThis cannot be undone.`)) return;
    try { await appointmentsAPI.remove(a.id); } catch (err) { alert(err.error || 'Delete failed'); }
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26 }}>🗓</span> Appointments
          </h1>
          <p className="page-subtitle">Sales &amp; appointments booked by agents — with call recordings &amp; notes</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Appointment Accepted (This Week)', value: stats.accepted,   grad: 'grad-1', icon: '✅' },
          { label: 'Appointment Made Today', value: stats.made_today, grad: 'grad-2', icon: '🗓' },
          { label: 'This Week',            value: stats.this_week,   grad: 'grad-3', icon: '📅' },
          { label: 'Appointment Cancelled (This Week)', value: stats.cancelled,  grad: 'grad-0', icon: '✖' },
        ].map(s => (
          <div key={s.label} className={`stat-card ${s.grad}`}>
            <div className="stat-icon">{s.icon}</div>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ fontSize: 32 }}>{s.value || 0}</div>
          </div>
        ))}
      </div>

      {/* Info banner */}
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(0,230,118,0.06)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 'var(--radius-lg)', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 16 }}>💡</span>
        <span>
          Shows calls an agent dispositioned as a <strong style={{ color: 'var(--success)' }}>Sale</strong> or <strong style={{ color: 'var(--purple)' }}>Appointment</strong>.
          Showing <strong>today</strong> by default — use the date filter to widen, or Clear to see all. Click <strong>View Sheet</strong> for full lead details, notes &amp; recording.
        </span>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input className="input" style={{ width: 260 }} placeholder="Search by name, phone, agent..."
          value={filters.search} onChange={e => setFilter('search', e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>From:</span>
          <input className="input" type="date" style={{ width: 150 }} value={filters.date_from} onChange={e => setFilter('date_from', e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>To:</span>
          <input className="input" type="date" style={{ width: 150 }} value={filters.date_to} onChange={e => setFilter('date_to', e.target.value)} />
        </div>
        {(filters.search || filters.date_from || filters.date_to) && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilters({ search: '', date_from: '', date_to: '' }); setPage(1); }}>Clear</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>{total.toLocaleString()} appointments</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : appointments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗓</div>
            <div className="empty-text">No appointments yet</div>
            <div className="empty-sub">Appointments appear when agents dispose calls with an appointment-flagged disposition</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lead</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Campaign</th>
                <th>Disposition</th>
                <th>Date &amp; Time</th>
                <th>Duration</th>
                <th>Recording</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map(a => {
                const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || '—';
                const dur = a.duration ? `${Math.floor(a.duration/60)}:${(a.duration%60).toString().padStart(2,'0')}` : '—';
                return (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{name}</div>
                      {a.email && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.email}</div>}
                    </td>
                    <td><span className="mono" style={{ color: 'var(--accent)' }}>{a.phone}</span></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{a.agent_name || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>EXT {a.agent_extension || '—'}</div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.campaign_name || '—'}</td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: `${a.disposition_color || '#00e676'}22`, color: a.disposition_color || 'var(--success)', border: `1px solid ${a.disposition_color || '#00e676'}44` }}>
                        {a.disposition_label}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {new Date(a.called_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td className="mono">{dur}</td>
                    <td style={{ minWidth: 200 }}>
                      <AudioPlayer callId={a.recording_file ? a.id : null} compact />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="btn btn-primary btn-sm" onClick={() => setSelected(a)} title="View full lead sheet">📋 View</button>
                        <button title="Approve booking (add a comment the agent will see)" onClick={() => openStatus(a.id, 'accepted')}
                          style={{ width: 32, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 800,
                            background: a.appointment_status === 'accepted' ? 'var(--success)' : 'rgba(16,185,129,0.12)',
                            color: a.appointment_status === 'accepted' ? '#fff' : 'var(--success)',
                            border: `1px solid ${a.appointment_status === 'accepted' ? 'var(--success)' : 'rgba(16,185,129,0.45)'}` }}>✓</button>
                        <button title="Decline booking (add a comment the agent will see)" onClick={() => openStatus(a.id, 'cancelled')}
                          style={{ width: 32, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 800,
                            background: a.appointment_status === 'cancelled' ? 'var(--danger)' : 'rgba(239,68,68,0.12)',
                            color: a.appointment_status === 'cancelled' ? '#fff' : 'var(--danger)',
                            border: `1px solid ${a.appointment_status === 'cancelled' ? 'var(--danger)' : 'rgba(239,68,68,0.45)'}` }}>✗</button>
                        <button title="Delete permanently" onClick={() => handleDelete(a)}
                          style={{ width: 32, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 14,
                            background: 'rgba(107,114,128,0.10)', color: 'var(--text-secondary)', border: '1px solid rgba(107,114,128,0.3)' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {total > 50 && (
        <div className="pagination" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="page-info">Page {page} of {Math.ceil(total / 50)} · {total.toLocaleString()} total</span>
          <button className="btn btn-secondary btn-sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {selected && <LeadSheet appt={selected} onClose={() => setSelected(null)} />}

      {/* Accept / Cancel note prompt — the note is saved onto the lead */}
      {noteModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && setNoteModal(null)}>
          <div style={{ background: 'var(--bg-card)', border: `2px solid ${noteModal.status === 'accepted' ? 'rgba(16,185,129,0.45)' : 'rgba(239,68,68,0.45)'}`, borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 460, padding: 22, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6, color: noteModal.status === 'accepted' ? 'var(--success)' : 'var(--danger)' }}>
              {noteModal.status === 'accepted' ? '✓ Approve Booking' : '✗ Decline Booking'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14 }}>Add a comment (optional) — the agent will see it in their Booked Leads panel, and it's saved on the lead sheet.</div>
            <textarea className="input" rows={4} value={noteText} onChange={e => setNoteText(e.target.value)} autoFocus
              placeholder={noteModal.status === 'accepted' ? 'e.g. Customer confirmed appointment for Tuesday 2pm' : 'e.g. Customer changed their mind, no longer interested'}
              style={{ width: '100%', resize: 'vertical', marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setNoteModal(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmStatus} disabled={busy}
                style={{ background: noteModal.status === 'accepted' ? 'var(--success)' : 'var(--danger)', border: 'none' }}>
                {busy ? 'Saving…' : (noteModal.status === 'accepted' ? 'Confirm Approve' : 'Confirm Decline')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}