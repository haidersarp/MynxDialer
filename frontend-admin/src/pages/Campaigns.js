import React, { useState, useEffect, useCallback } from 'react';
import { campaignsAPI, cidAPI, adminAPI } from '../services/api';

function HopperPanel({ campaigns }) {
  const [hopperData, setHopperData] = useState({});
  const [loading, setLoading] = useState({});

  const loadAll = useCallback(async () => {
    const active = campaigns.filter(c => c.status === 'active');
    for (const c of active) {
      try {
        const stats = await campaignsAPI.hopperStats(c.id);
        setHopperData(prev => ({ ...prev, [c.id]: { ...stats, campaign_name: c.name } }));
      } catch (_) {}
    }
  }, [campaigns]);

  useEffect(() => { loadAll(); const iv = setInterval(loadAll, 6000); return () => clearInterval(iv); }, [loadAll]);

  const handleRefill = async (id) => {
    setLoading(prev => ({ ...prev, [id]: true }));
    await campaignsAPI.hopperRefill(id).catch(() => {});
    const stats = await campaignsAPI.hopperStats(id).catch(() => null);
    if (stats) setHopperData(prev => ({ ...prev, [id]: { ...stats, campaign_name: prev[id]?.campaign_name } }));
    setLoading(prev => ({ ...prev, [id]: false }));
  };

  const handleFlush = async (id) => {
    if (!window.confirm('Clear and refill hopper for this campaign?')) return;
    await campaignsAPI.hopperFlush(id).catch(() => {});
    await handleRefill(id);
  };

  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  if (activeCampaigns.length === 0) return null;

  return (
    <div className="card card-glow" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <h3 className="card-title">
          <span style={{ color: 'var(--accent)', marginRight: 8 }}>📦</span>
          Hopper Control
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 10 }}>
            Pre-loaded leads buffer — auto-refills every 5s
          </span>
        </h3>
        <button className="btn btn-secondary btn-sm" onClick={loadAll}>↻ Refresh</button>
      </div>

      {/* Priority legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', fontSize: 12 }}>
        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Priority order:</span>
        <span>📞 <span style={{ color: 'var(--warning)', fontWeight: 700 }}>Callbacks</span> <span style={{ color: 'var(--text-muted)' }}>first</span></span>
        <span>🆕 <span style={{ color: 'var(--accent)', fontWeight: 700 }}>New leads</span> <span style={{ color: 'var(--text-muted)' }}>second</span></span>
        <span>🔄 <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>Recycled</span> <span style={{ color: 'var(--text-muted)' }}>last</span></span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>Set hopper level in campaign settings (Edit Campaign)</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {activeCampaigns.map(c => {
          const h = hopperData[c.id];
          const level = c.hopper_level || 100;
          const ready = h?.ready || 0;
          const pct = Math.round((ready / level) * 100);
          const color = pct > 60 ? 'var(--success)' : pct > 30 ? 'var(--warning)' : 'var(--danger)';

          return (
            <div key={c.id} style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{c.name}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {h?.callbacks > 0 && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(210,153,34,0.2)', color: 'var(--warning)', fontWeight: 700 }}>📞 {h.callbacks} callbacks</span>}
                    {h?.new_leads > 0  && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(0,212,255,0.1)',  color: 'var(--accent)',  fontWeight: 700 }}>🆕 {h.new_leads} new</span>}
                    {h?.recycled > 0   && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(72,79,88,0.2)',     color: 'var(--text-secondary)', fontWeight: 700 }}>🔄 {h.recycled} recycled</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 800, color }}>
                    {ready}<span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>/{level}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>leads ready</div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ height: 8, background: 'var(--bg-input)', borderRadius: 4, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: color, borderRadius: 4, transition: 'width 0.5s',
                  boxShadow: pct > 60 ? '0 0 8px rgba(63,185,80,0.4)' : pct > 30 ? '0 0 8px rgba(210,153,34,0.4)' : '0 0 8px rgba(248,81,73,0.4)' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                <span>{pct}% full</span>
                {h?.dialing > 0 && <span style={{ color: 'var(--danger)' }}>● {h.dialing} dialing now</span>}
                <span>Level: <strong>{level}</strong></span>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => handleRefill(c.id)} disabled={loading[c.id]}>
                  {loading[c.id] ? '...' : '↺ Refill Now'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => handleFlush(c.id)} title="Clear and refill">
                  🔄 Reset
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BLANK = {
  name: '', description: '', dial_method: 'progressive', dial_ratio: 1.0,
  max_attempts: 3, retry_delay: 3600, cid_group_id: '', sip_trunk_id: '', queue_name: 'default',
  script: '', timezone: 'Europe/London', start_time: '08:00', end_time: '21:00',
  amd_enabled: false, record_calls: false, hopper_level: 1000, hopper_threshold: 100
};

function HopperStatus({ campaignId, campaignStatus }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (campaignStatus !== 'active') return;
    try {
      const data = await campaignsAPI.hopperStats(campaignId);
      setStats(data);
    } catch (_) {}
  }, [campaignId, campaignStatus]);

  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, [load]);

  if (campaignStatus !== 'active' || !stats) return null;

  const pct = stats.hopper_level > 0 ? Math.round((stats.ready / stats.hopper_level) * 100) : 0;
  const color = pct > 60 ? 'var(--success)' : pct > 30 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3, color: 'var(--text-secondary)' }}>
          <span style={{ fontWeight: 700, color }}>HOPPER {stats.ready}/{stats.hopper_level}</span>
          <span style={{ color: 'var(--text-muted)' }}>
            {stats.callbacks > 0 && <span style={{ color: 'var(--warning)', marginRight: 4 }}>📞{stats.callbacks}</span>}
            {stats.new_leads > 0 && <span style={{ color: 'var(--accent)', marginRight: 4 }}>🆕{stats.new_leads}</span>}
            {stats.recycled > 0 && <span style={{ color: 'var(--text-muted)' }}>🔄{stats.recycled}</span>}
          </span>
        </div>
        <div style={{ height: 5, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
        </div>
      </div>
      <button
        className="btn btn-sm btn-secondary"
        style={{ fontSize: 10, padding: '2px 8px' }}
        onClick={async (e) => { e.stopPropagation(); setLoading(true); await campaignsAPI.hopperRefill(campaignId).catch(() => {}); await load(); setLoading(false); }}
        disabled={loading}
        title="Refill hopper now"
      >
        {loading ? '...' : '↺'}
      </button>
    </div>
  );
}

function CampaignModal({ campaign, cidGroups, sipTrunks = [], onSave, onClose }) {
  const [form, setForm] = useState(campaign || BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (campaign?.id) await campaignsAPI.update(campaign.id, form);
      else await campaignsAPI.create(form);
      onSave();
    } catch (err) {
      setError(err.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title">{campaign ? 'Edit Campaign' : 'New Campaign'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Campaign Name *</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <input className="input" value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dial Method</label>
                <select className="select" value={form.dial_method} onChange={e => set('dial_method', e.target.value)}>
                  <option value="preview">Preview</option>
                  <option value="progressive">Progressive</option>
                  <option value="predictive">Predictive</option>
                  <option value="power">Power</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Dial Ratio <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: 11 }}>(calls per available agent)</span></label>
                <input className="input" type="number" step="0.5" min="1" max="100"
                  value={form.dial_ratio} onChange={e => set('dial_ratio', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Max Attempts</label>
                <input className="input" type="number" min="1" max="20"
                  value={form.max_attempts} onChange={e => set('max_attempts', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Retry Delay (secs)</label>
                <input className="input" type="number" min="60"
                  value={form.retry_delay} onChange={e => set('retry_delay', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">CID Group</label>
                <select className="select" value={form.cid_group_id} onChange={e => set('cid_group_id', e.target.value)}>
                  <option value="">— None —</option>
                  {cidGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">SIP Provider</label>
                <select className="select" value={form.sip_trunk_id || ''} onChange={e => set('sip_trunk_id', e.target.value)}>
                  <option value="">— Default provider —</option>
                  {sipTrunks.filter(t => t.active).map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <select className="select" value={form.timezone} onChange={e => set('timezone', e.target.value)}>
                  <option value="Europe/London">Europe/London (UK)</option>
                  <option value="Europe/Dublin">Europe/Dublin (Ireland)</option>
                  <option value="Europe/Paris">Europe/Paris (CET)</option>
                  <option value="Europe/Berlin">Europe/Berlin (Germany)</option>
                  <option value="America/New_York">America/New_York (ET)</option>
                  <option value="America/Chicago">America/Chicago (CT)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  <option value="Asia/Karachi">Asia/Karachi (PKT)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="form-group" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Time</label>
                <input className="input" type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">End Time</label>
                <input className="input" type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Call Script</label>
              <textarea className="textarea" rows={4} value={form.script}
                onChange={e => set('script', e.target.value)}
                placeholder="Write the agent script here..." />
            </div>
            <div style={{ margin: '16px 0 8px', padding: '8px 12px', background: 'rgba(0,212,255,0.04)', borderRadius: 'var(--radius)', border: '1px solid rgba(0,212,255,0.15)', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              📦 Hopper Settings
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Hopper Level <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none' }}>(target buffer size, max 10000)</span></label>
                <input className="input" type="number" min="10" max="10000"
                  value={form.hopper_level} onChange={e => set('hopper_level', Math.min(10000, parseInt(e.target.value) || 100))} />
              </div>
              <div className="form-group">
                <label className="form-label">Refill Threshold <span style={{ color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none' }}>(refill when it drops to this)</span></label>
                <input className="input" type="number" min="0" max="10000"
                  value={form.hopper_threshold} onChange={e => set('hopper_threshold', Math.min(10000, parseInt(e.target.value) || 0))} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: -6, marginBottom: 8 }}>
              The hopper auto-fills to <strong>{form.hopper_level || 0}</strong> and tops back up once it drains to <strong>{form.hopper_threshold ?? 0}</strong>.
              Priority: <span style={{ color: 'var(--warning)' }}>Callbacks</span> → <span style={{ color: 'var(--accent)' }}>New leads</span> → <span style={{ color: 'var(--text-muted)' }}>Recycled</span>
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.amd_enabled} onChange={e => set('amd_enabled', e.target.checked)} />
                AMD Enabled
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={form.record_calls} onChange={e => set('record_calls', e.target.checked)} />
                Record Calls
              </label>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Campaign'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Campaigns() {
  const [campaigns, setCampaigns] = useState([]);
  const [cidGroups, setCidGroups] = useState([]);
  const [sipTrunks, setSipTrunks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const [c, g, t] = await Promise.all([
      campaignsAPI.list(), cidAPI.list(), adminAPI.sipTrunks().catch(() => [])
    ]).catch(() => [[], [], []]);
    setCampaigns(c || []);
    setCidGroups(g || []);
    setSipTrunks(t || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleStatus = async (id, status) => {
    await campaignsAPI.setStatus(id, status).catch(e => alert(e.error || 'Failed'));
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this campaign?')) return;
    await campaignsAPI.delete(id).catch(e => alert(e.error || 'Failed'));
    load();
  };

  const filtered = campaigns.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = { active: 'var(--success)', inactive: 'var(--text-muted)', paused: 'var(--warning)' };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">{campaigns.length} campaigns</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ New Campaign</button>
      </div>

      <HopperPanel campaigns={campaigns} />

      <div className="filter-bar">
        <input className="input" style={{ width: 250 }} placeholder="Search campaigns..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <div className="empty-text">No campaigns yet</div>
            <div className="empty-sub">Create your first campaign to start dialing</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Method</th>
                <th>Ratio</th>
                <th>Leads</th>
                <th>Remaining</th>
                <th>Hopper</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.description}</div>}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{c.dial_method}</td>
                  <td className="mono">{c.dial_ratio}x</td>
                  <td className="mono">{(c.total_leads || 0).toLocaleString()}</td>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{(c.new_leads || 0).toLocaleString()}</td>
                  <td style={{ minWidth: 160 }}>
                    <HopperStatus campaignId={c.id} campaignStatus={c.status} />
                  </td>
                  <td>
                    <span className={`badge badge-${c.status}`} style={{ color: statusColor[c.status] }}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.status !== 'active' && (
                        <button className="btn btn-sm btn-success" onClick={() => handleStatus(c.id, 'active')}>▶ Start</button>
                      )}
                      {c.status === 'active' && (
                        <button className="btn btn-sm btn-secondary" onClick={() => handleStatus(c.id, 'paused')}>⏸ Pause</button>
                      )}
                      {(c.status === 'active' || c.status === 'paused') && (
                        <button className="btn btn-sm btn-secondary" onClick={() => handleStatus(c.id, 'inactive')}>■ Stop</button>
                      )}
                      <button className="btn btn-sm btn-secondary" onClick={() => setModal(c)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal !== null && (
        <CampaignModal
          campaign={modal.id ? modal : null}
          cidGroups={cidGroups}
          sipTrunks={sipTrunks}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
