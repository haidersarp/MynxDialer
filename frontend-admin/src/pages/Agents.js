import React, { useState, useEffect, useCallback } from 'react';
import { agentsAPI, campaignsAPI } from '../services/api';

const BLANK = { username: '', password: '', email: '', full_name: '', role: 'agent', extension: '', sip_password: '' };

function AgentModal({ agent, onSave, onClose }) {
  const [form, setForm]                   = useState(agent || BLANK);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState('');
  const [allCampaigns, setAllCampaigns]   = useState([]);
  const [assignedIds, setAssignedIds]     = useState([]);
  const [allAccess, setAllAccess]         = useState(true);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    campaignsAPI.list().then(d => setAllCampaigns(d || [])).catch(() => {});
    if (agent?.id) {
      agentsAPI.getCampaigns(agent.id).then(ids => {
        if (ids?.length > 0) { setAllAccess(false); setAssignedIds(ids); }
        else setAllAccess(true);
      }).catch(() => {});
    }
  }, [agent?.id]);

  const toggleCampaign = (cid) => setAssignedIds(prev =>
    prev.includes(cid) ? prev.filter(id => id !== cid) : [...prev, cid]
  );

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload = { ...form };
      if (agent?.id && !payload.password) delete payload.password;
      let agentId;
      if (agent?.id) { await agentsAPI.update(agent.id, payload); agentId = agent.id; }
      else { const r = await agentsAPI.create(payload); agentId = r.id; }
      await agentsAPI.setCampaigns(agentId, allAccess ? [] : assignedIds);
      onSave();
    } catch (err) {
      setError(err.error || 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title">{agent ? 'Edit Agent' : 'New Agent'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Username *</label>
                <input className="input" value={form.username} onChange={e => set('username', e.target.value)} required disabled={!!agent} />
              </div>
              <div className="form-group">
                <label className="form-label">{agent ? 'New Password' : 'Password *'}</label>
                <input className="input" type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} required={!agent} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="input" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="input" type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="select" value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="agent">Agent</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Extension</label>
                <input className="input" value={form.extension || ''} onChange={e => set('extension', e.target.value)} placeholder="e.g. 1001" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">SIP Password</label>
              <input className="input" value={form.sip_password || ''} onChange={e => set('sip_password', e.target.value)} placeholder="SIP registration password" />
            </div>
            {agent && (
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={form.active !== 0} onChange={e => set('active', e.target.checked ? 1 : 0)} />
                  Active
                </label>
              </div>
            )}
            {/* Campaign Access */}
            <div style={{ marginTop: 8, padding: '14px 16px', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '2px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>🎯 Campaign Access</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Which campaigns can this agent see and dial?</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  <input type="checkbox" checked={allAccess} onChange={e => setAllAccess(e.target.checked)} style={{ width: 16, height: 16 }} />
                  All Campaigns
                </label>
              </div>
              {!allAccess && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflow: 'auto' }}>
                  {allCampaigns.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>No campaigns created yet</div>
                  ) : allCampaigns.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, background: assignedIds.includes(c.id) ? 'rgba(124,58,237,0.08)' : 'var(--bg-secondary)', border: `2px solid ${assignedIds.includes(c.id) ? 'var(--purple)' : 'var(--border)'}`, transition: 'all 0.15s' }}>
                      <input type="checkbox" checked={assignedIds.includes(c.id)} onChange={() => toggleCampaign(c.id)} style={{ width: 16, height: 16, accentColor: 'var(--purple)' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {c.status} · {(c.total_leads || 0).toLocaleString()} leads
                        </div>
                      </div>
                      {assignedIds.includes(c.id) && <span style={{ fontSize: 12, color: 'var(--purple)', fontWeight: 700 }}>✓</span>}
                    </label>
                  ))}
                </div>
              )}
              {!allAccess && assignedIds.length === 0 && (
                <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, fontSize: 12, color: 'var(--warning)' }}>
                  ⚠ No campaigns selected — agent won't see any campaigns
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [pwModal, setPwModal] = useState(null);   // agent whose password we're changing
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await agentsAPI.list();
      setAgents(data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Deactivate this agent?')) return;
    await agentsAPI.delete(id).catch(e => alert(e.error));
    load();
  };

  // Permanently delete the agent (removes the record, frees its extension back to
  // the pool). Call history is kept but no longer attributed to a named agent.
  const handleHardDelete = async (a) => {
    const extNote = a.extension ? `\n\nExtension ${a.extension} will return to the pool for reuse.` : '';
    if (!window.confirm(`PERMANENTLY delete agent "${a.full_name || a.username}"?\n\nThis cannot be undone.${extNote}\n\nTheir past calls/sales stay in the records but will no longer show under their name.`)) return;
    await agentsAPI.hardDelete(a.id).catch(e => alert(e.error || 'Delete failed'));
    load();
  };

  const filtered = agents.filter(a =>
    !search || [a.full_name, a.username, a.extension, a.email].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const statusColors = { available: 'var(--success)', oncall: 'var(--danger)', paused: 'var(--warning)', offline: 'var(--text-muted)', online: 'var(--info)' };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-subtitle">{agents.length} agents configured</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ New Agent</button>
      </div>

      <div className="filter-bar">
        <input className="input" style={{ width: 260 }} placeholder="Search by name, username, extension..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Role</th>
                <th>Extension</th>
                <th>Status</th>
                <th>Campaign</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.username} · {a.email || '—'}</div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-tertiary)', fontSize: 11, fontWeight: 600 }}>
                      {a.role}
                    </span>
                  </td>
                  <td className="mono">{a.extension || '—'}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span className={`status-dot ${a.status || 'offline'}`} />
                      <span style={{ fontSize: 12, color: statusColors[a.status] || 'var(--text-muted)', fontWeight: 600 }}>
                        {a.status || 'offline'}
                      </span>
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{a.campaign_name || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setModal(a)}>Edit</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setPwModal(a)}
                        title="Change only this agent's login password (nothing else changes)">🔑 Password</button>
                      {a.active ? (
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(a.id)}>Deactivate</button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Inactive</span>
                      )}
                      <button className="btn btn-sm" onClick={() => handleHardDelete(a)}
                        title="Permanently delete this agent and free its extension"
                        style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                        🗑 Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal !== null && (
        <AgentModal
          agent={modal.id ? modal : null}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}

      {pwModal && (
        <SetPasswordModal agent={pwModal} onClose={() => setPwModal(null)} />
      )}
    </div>
  );
}

// Change ONLY an agent's login password — updates the password field and nothing
// else, so SIP/extension/campaign settings are never touched (calls keep working).
function SetPasswordModal({ agent, onClose }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    if (pw.length < 6) { setErr('Password must be at least 6 characters'); return; }
    if (pw !== pw2) { setErr('Passwords do not match'); return; }
    setBusy(true); setErr('');
    try {
      await agentsAPI.update(agent.id, { password: pw });   // password-only update
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (e2) { setErr(e2.error || 'Failed to change password'); setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3 className="modal-title">🔑 Change Password — {agent.full_name || agent.username}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={save}>
          <div className="modal-body">
            {err && <div className="alert alert-error">{err}</div>}
            {done ? (
              <div className="alert alert-success">Password updated ✓</div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Sets a new login password for this agent. Nothing else changes — their extension and SIP keep working.
                </div>
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input className="input" type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 6 characters" />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm Password</label>
                  <input className="input" type="password" value={pw2} onChange={e => setPw2(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {!done && (
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set Password'}</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
