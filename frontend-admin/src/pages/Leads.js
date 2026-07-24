import React, { useState, useEffect, useCallback, useRef } from 'react';
import { leadsAPI, campaignsAPI, adminAPI } from '../services/api';

const STATUS_COLORS = {
  new: '#00d4ff', called: '#58a6ff', answered: '#3fb950',
  no_answer: '#8b949e', busy: '#d29922', failed: '#f85149',
  dnc: '#ff7b72', completed: '#3fb950', callback: '#e3b341'
};

function DispoBreakdown({ campaignId }) {
  const [data, setData] = useState([]);
  useEffect(() => {
    if (!campaignId) return;
    Promise.all([
      leadsAPI.list({ campaign_id: campaignId, limit: 1 }),
    ]).catch(() => {});
    // Build breakdown from leads API
    const statuses = ['new','called','answered','no_answer','busy','failed','dnc','completed','callback'];
    Promise.all(statuses.map(s => leadsAPI.list({ campaign_id: campaignId, status: s, limit: 1 })
      .then(r => ({ status: s, count: r.total || 0 })).catch(() => ({ status: s, count: 0 }))
    )).then(setData);
  }, [campaignId]);

  const total = data.reduce((a, b) => a + b.count, 0);
  if (!total) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {data.filter(d => d.count > 0).map(d => (
        <div key={d.status} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 4, background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[d.status] || '#666' }} />
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{d.status}:</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: STATUS_COLORS[d.status] || 'var(--text-primary)' }}>{d.count.toLocaleString()}</span>
          {total > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>({((d.count/total)*100).toFixed(0)}%)</span>}
        </div>
      ))}
    </div>
  );
}

export default function Leads() {
  const [leads, setLeads]           = useState([]);
  const [campaigns, setCampaigns]   = useState([]);
  const [dispositions, setDisps]    = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(true);
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const [filters, setFilters]       = useState({ status: '', search: '' });
  const [showStats, setShowStats]   = useState(false);
  const fileRef = useRef();
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (selectedCampaign) params.campaign_id = selectedCampaign;
      if (filters.status)   params.status = filters.status;
      if (filters.search)   params.search = filters.search;
      const data = await leadsAPI.list(params);
      setLeads(data.leads || []);
      setTotal(data.total || 0);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page, selectedCampaign, filters]);

  useEffect(() => {
    campaignsAPI.list().then(d => setCampaigns(d || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedCampaign) {
      adminAPI.dispositions(selectedCampaign).then(setDisps).catch(() => {});
    }
  }, [selectedCampaign]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!selectedCampaign) { alert('Select a campaign first'); e.target.value = ''; return; }
    setImporting(true); setImportResult(null);
    try {
      const result = await leadsAPI.import(file, selectedCampaign);
      setImportResult(result); load();
    } catch (err) { setImportResult({ error: err.error || 'Import failed' }); }
    finally { setImporting(false); e.target.value = ''; }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this lead?')) return;
    await leadsAPI.delete(id).catch(e => alert(e.error));
    load();
  };

  const totalPages = Math.ceil(total / LIMIT);
  const activeCampaign = campaigns.find(c => c.id === parseInt(selectedCampaign));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="page-subtitle">{total.toLocaleString()} records{activeCampaign ? ` in "${activeCampaign.name}"` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowStats(!showStats)}>
            {showStats ? 'Hide Stats' : '📊 Show Stats'}
          </button>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? '⏳ Importing...' : '↑ Import CSV'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleImport} />
        </div>
      </div>

      {/* Import instructions card */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(0,212,255,0.04)', borderColor: 'rgba(0,212,255,0.2)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>📋 CSV Import — Column Names (auto-detected)</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <strong>Required:</strong> <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>phone</code> or <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>telephone</code> or <code style={{ background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>number</code><br />
              <strong>Optional:</strong> first_name, last_name, email, address, city, state, zip, alt_phone, dob + any custom columns
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Import to Campaign</div>
              <select className="select" style={{ width: 220 }} value={selectedCampaign}
                onChange={e => { setSelectedCampaign(e.target.value); setPage(1); }}>
                <option value="">All Campaigns</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className={`alert ${importResult.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 14 }}>
          {importResult.error ? importResult.error : (
            <span>
              ✅ Import complete: <strong>{importResult.imported}</strong> imported &nbsp;·&nbsp;
              <strong>{importResult.duplicates}</strong> duplicates skipped &nbsp;·&nbsp;
              <strong>{importResult.dnc_skipped}</strong> DNC skipped &nbsp;·&nbsp;
              <strong>{importResult.skipped}</strong> invalid rows
            </span>
          )}
        </div>
      )}

      {/* Disposition breakdown */}
      {showStats && selectedCampaign && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3 className="card-title">Lead Status Breakdown — {activeCampaign?.name}</h3>
          </div>
          <DispoBreakdown campaignId={selectedCampaign} />

          {/* Disposition results */}
          {dispositions.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', marginBottom: 10, marginTop: 6 }}>
                Disposition Results
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {dispositions.map(d => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: d.color + '18', border: `1px solid ${d.color}44` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: d.color }}>{d.label}</span>
                    {d.is_sale && <span style={{ fontSize: 9, padding: '1px 4px', background: 'rgba(63,185,80,0.2)', color: 'var(--success)', borderRadius: 2, fontWeight: 700 }}>SALE</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar">
        <input className="input" style={{ width: 240 }} placeholder="Search phone, name, email..."
          value={filters.search} onChange={e => { setFilters(f => ({...f, search: e.target.value})); setPage(1); }} />
        <select className="select" style={{ width: 150 }} value={filters.status}
          onChange={e => { setFilters(f => ({...f, status: e.target.value})); setPage(1); }}>
          <option value="">All Statuses</option>
          {['new','called','answered','no_answer','busy','failed','dnc','completed','callback'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(filters.search || filters.status) && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilters({ status: '', search: '' }); setPage(1); }}>
            Clear Filters
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          {total.toLocaleString()} records
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading leads...</div>
        ) : leads.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            <div className="empty-text">No leads found</div>
            <div className="empty-sub">Select a campaign and import a CSV file to add leads</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Name</th>
                <th>Email</th>
                <th>Location</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last Disp.</th>
                <th>DNC</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{l.phone}</span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{[l.first_name, l.last_name].filter(Boolean).join(' ') || <span style={{ color: 'var(--text-muted)' }}>—</span>}</div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.email || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {[l.city, l.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                      background: (STATUS_COLORS[l.status] || '#666') + '20',
                      color: STATUS_COLORS[l.status] || 'var(--text-muted)'
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                      {l.status}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ color: l.attempts >= 3 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                      {l.attempts}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{l.last_disposition || '—'}</td>
                  <td>
                    {l.is_dnc ? <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 700, padding: '1px 6px', background: 'rgba(248,81,73,0.15)', borderRadius: 3 }}>DNC</span> : null}
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(l.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(l.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="pagination" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p-1)}>← Prev</button>
          <span className="page-info">Page {page} of {totalPages} · {total.toLocaleString()} total</span>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p+1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
