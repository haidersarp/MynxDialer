import React, { useState, useEffect, useCallback } from 'react';
import { cidAPI, adminAPI, campaignsAPI } from '../services/api';

export default function CIDGroups() {
  const [groups, setGroups] = useState([]);
  const [trunks, setTrunks] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showNumModal, setShowNumModal] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: '', rotation_type: 'round_robin', sip_trunk_id: '', campaign_id: '' });
  const [numForm, setNumForm] = useState({ number: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [data, t, c] = await Promise.all([
      cidAPI.list().catch(() => []),
      adminAPI.sipTrunks().catch(() => []),
      campaignsAPI.list().catch(() => []),
    ]);
    setGroups(data || []);
    setTrunks(t || []);
    setCampaigns(c || []);
    setLoading(false);
  }, []);

  const loadGroup = useCallback(async (id) => {
    const data = await cidAPI.get(id).catch(() => null);
    if (data) setSelected(data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateGroup = async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await cidAPI.create(groupForm);
      setShowGroupModal(false);
      setGroupForm({ name: '', rotation_type: 'round_robin', sip_trunk_id: '', campaign_id: '' });
      load();
    } catch (err) { setError(err.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleAddNumber = async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await cidAPI.addNumber(selected.id, numForm);
      setShowNumModal(false);
      setNumForm({ number: '', description: '' });
      loadGroup(selected.id);
    } catch (err) { setError(err.error || 'Failed'); }
    finally { setSaving(false); }
  };

  // Inline-save the selected group's SIP trunk / campaign association.
  const updateGroupSetting = async (patch) => {
    if (!selected) return;
    const body = {
      name: selected.name, rotation_type: selected.rotation_type,
      sip_trunk_id: selected.sip_trunk_id || null, campaign_id: selected.campaign_id || null,
      ...patch,
    };
    setSelected(s => ({ ...s, ...body }));
    try { await cidAPI.update(selected.id, body); await load(); await loadGroup(selected.id); }
    catch (err) { alert(err.error || 'Failed to update'); }
  };

  const handleDeleteGroup = async (id) => {
    if (!window.confirm('Delete this CID group and all numbers?')) return;
    await cidAPI.delete(id);
    if (selected?.id === id) setSelected(null);
    load();
  };

  const handleDeleteNumber = async (nid) => {
    await cidAPI.deleteNumber(selected.id, nid);
    loadGroup(selected.id);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Caller ID Groups</h1>
          <p className="page-subtitle">Manage caller ID numbers and rotation</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowGroupModal(true)}>+ New Group</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
        {/* Groups list */}
        <div className="card" style={{ padding: 0, alignSelf: 'start' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}>
            Groups ({groups.length})
          </div>
          {loading ? (
            <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>No groups yet</div>
          ) : (
            groups.map(g => (
              <div
                key={g.id}
                onClick={() => loadGroup(g.id)}
                style={{
                  padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-muted)',
                  background: selected?.id === g.id ? 'var(--bg-hover)' : 'transparent',
                  borderLeft: selected?.id === g.id ? '2px solid var(--accent)' : '2px solid transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {g.rotation_type} · {g.number_count} number{g.number_count !== 1 ? 's' : ''}
                  </div>
                </div>
                <button className="btn-icon" style={{ fontSize: 11 }}
                  onClick={e => { e.stopPropagation(); handleDeleteGroup(g.id); }}>✕</button>
              </div>
            ))
          )}
        </div>

        {/* Numbers panel */}
        {selected ? (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{selected.rotation_type} rotation</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setShowNumModal(true)}>+ Add Number</button>
            </div>
            {/* Association: which SIP service + campaign this group serves (auto-saves) */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-muted)', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SIP Service</span>
                <select className="select" style={{ width: 180, height: 32, fontSize: 13 }} value={selected.sip_trunk_id || ''} onChange={e => updateGroupSetting({ sip_trunk_id: e.target.value || null })}>
                  <option value="">— Any —</option>
                  {trunks.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Campaign</span>
                <select className="select" style={{ width: 200, height: 32, fontSize: 13 }} value={selected.campaign_id || ''} onChange={e => updateGroupSetting({ campaign_id: e.target.value || null })}>
                  <option value="">★ All campaigns</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(selected.numbers || []).map(n => (
                  <tr key={n.id}>
                    <td className="mono" style={{ fontSize: 14, color: 'var(--accent)' }}>{n.number}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{n.description || '—'}</td>
                    <td>
                      <span style={{ fontSize: 11, fontWeight: 600, color: n.active ? 'var(--success)' : 'var(--text-muted)' }}>
                        {n.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteNumber(n.id)}>Remove</button>
                    </td>
                  </tr>
                ))}
                {(!selected.numbers || selected.numbers.length === 0) && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No numbers in this group</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card">
            <div className="empty-state">
              <div className="empty-icon">📞</div>
              <div className="empty-text">Select a group</div>
              <div className="empty-sub">Click a group to view and manage its numbers</div>
            </div>
          </div>
        )}
      </div>

      {showGroupModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">New CID Group</h3>
              <button className="btn-icon" onClick={() => setShowGroupModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateGroup}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}
                <div className="form-group">
                  <label className="form-label">Group Name *</label>
                  <input className="input" value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Rotation Type</label>
                  <select className="select" value={groupForm.rotation_type} onChange={e => setGroupForm(f => ({ ...f, rotation_type: e.target.value }))}>
                    <option value="round_robin">Round Robin</option>
                    <option value="sequential">Sequential</option>
                    <option value="random">Random</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">SIP Service <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(which carrier these CLIs belong to)</span></label>
                  <select className="select" value={groupForm.sip_trunk_id} onChange={e => setGroupForm(f => ({ ...f, sip_trunk_id: e.target.value }))}>
                    <option value="">— Any / unset —</option>
                    {trunks.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Campaign <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(which campaign uses this group)</span></label>
                  <select className="select" value={groupForm.campaign_id} onChange={e => setGroupForm(f => ({ ...f, campaign_id: e.target.value }))}>
                    <option value="">★ All campaigns</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowGroupModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNumModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h3 className="modal-title">Add Number</h3>
              <button className="btn-icon" onClick={() => setShowNumModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddNumber}>
              <div className="modal-body">
                {error && <div className="alert alert-error">{error}</div>}
                <div className="form-group">
                  <label className="form-label">Phone Number *</label>
                  <input className="input" value={numForm.number} onChange={e => setNumForm(f => ({ ...f, number: e.target.value }))} placeholder="e.g. 18005551234" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="input" value={numForm.description} onChange={e => setNumForm(f => ({ ...f, description: e.target.value }))} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNumModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>Add</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
