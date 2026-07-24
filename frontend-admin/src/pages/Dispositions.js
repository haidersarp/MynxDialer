import React, { useState, useEffect, useCallback } from 'react';
import { adminAPI, campaignsAPI } from '../services/api';

const BLANK = { campaign_id: '', code: '', label: '', color: '#58a6ff', is_sale: false, is_dnc: false, is_callback: false, sort_order: 0 };

function DispModal({ disp, campaigns, onSave, onClose }) {
  const [form, setForm] = useState(disp || BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (disp?.id) await adminAPI.updateDisposition(disp.id, form);
      else await adminAPI.createDisposition(form);
      onSave();
    } catch (err) { setError(err.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3 className="modal-title">{disp ? 'Edit Disposition' : 'New Disposition'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Campaign (blank = global)</label>
              <select className="select" value={form.campaign_id} onChange={e => set('campaign_id', e.target.value)}>
                <option value="">— Global (all campaigns) —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Code *</label>
                <input className="input" value={form.code} onChange={e => set('code', e.target.value.toUpperCase())} required placeholder="e.g. SALE" />
              </div>
              <div className="form-group">
                <label className="form-label">Label *</label>
                <input className="input" value={form.label} onChange={e => set('label', e.target.value)} required placeholder="e.g. Sale Completed" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Color</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.color} onChange={e => set('color', e.target.value)} style={{ width: 40, height: 34, padding: 2, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }} />
                  <input className="input" value={form.color} onChange={e => set('color', e.target.value)} style={{ flex: 1 }} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Sort Order</label>
                <input className="input" type="number" value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[['is_sale', 'Sale'], ['is_dnc', 'Add to DNC'], ['is_callback', 'Callback'], ['is_appointment', 'Appointment']].map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={!!form[key]} onChange={e => set(key, e.target.checked)} />
                  {label}
                </label>
              ))}
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

export default function Dispositions() {
  const [disps, setDisps] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [modal, setModal] = useState(null);
  const [filterCampaign, setFilterCampaign] = useState('');

  const load = useCallback(async () => {
    const [d, c] = await Promise.all([
      adminAPI.dispositions(filterCampaign ? { campaign_id: filterCampaign } : {}),
      campaignsAPI.list()
    ]).catch(() => [[], []]);
    setDisps(d || []); setCampaigns(c || []);
  }, [filterCampaign]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete disposition?')) return;
    await adminAPI.deleteDisposition(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dispositions</h1>
          <p className="page-subtitle">Call outcome codes and labels</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ New Disposition</button>
      </div>

      <div className="filter-bar">
        <select className="select" style={{ width: 220 }} value={filterCampaign}
          onChange={e => setFilterCampaign(e.target.value)}>
          <option value="">All Dispositions</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Campaign</th>
              <th>Flags</th>
              <th>Color</th>
              <th>Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {disps.map(d => (
              <tr key={d.id}>
                <td>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: d.color + '22', color: d.color }}>
                    {d.code}
                  </span>
                </td>
                <td style={{ fontWeight: 500 }}>{d.label}</td>
                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {d.campaign_id ? campaigns.find(c => c.id === d.campaign_id)?.name || `Campaign ${d.campaign_id}` : <span style={{ color: 'var(--text-muted)' }}>Global</span>}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {d.is_sale        ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(63,185,80,0.2)',  color: 'var(--success)', fontWeight: 700 }}>SALE</span> : null}
                    {d.is_appointment ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.2)', color: '#a855f7',        fontWeight: 700 }}>APPT</span> : null}
                    {d.is_dnc ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(248,81,73,0.2)', color: 'var(--danger)', fontWeight: 700 }}>DNC</span> : null}
                    {d.is_callback ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(210,153,34,0.2)', color: 'var(--warning)', fontWeight: 700 }}>CB</span> : null}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: d.color }} />
                    <span className="mono" style={{ fontSize: 11 }}>{d.color}</span>
                  </div>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{d.sort_order}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => setModal(d)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d.id)}>Del</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== null && (
        <DispModal
          disp={modal.id ? modal : null}
          campaigns={campaigns}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
