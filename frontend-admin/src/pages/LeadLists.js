import React, { useState, useEffect, useCallback, useRef } from 'react';
import { leadListsAPI, leadsAPI, campaignsAPI, adminAPI } from '../services/api';

// ── Column mapping wizard ────────────────────────────────────────────────────
const SYSTEM_FIELDS = [
  { key: 'phone',      label: '📞 Phone Number *', required: true },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name',  label: 'Last Name' },
  { key: 'email',      label: 'Email' },
  { key: 'address',    label: 'Address' },
  { key: 'city',       label: 'City' },
  { key: 'state',      label: 'State/County' },
  { key: 'zip',        label: 'Zip/Postcode' },
  { key: 'alt_phone',  label: 'Alt Phone' },
  { key: 'dob',        label: 'Date of Birth' },
  { key: 'title',      label: 'Title' },
];

function ImportWizard({ campaigns, onImported, onClose }) {
  const [step,    setStep]    = useState(1); // 1=upload, 2=map columns, 3=settings, 4=importing
  const [file,    setFile]    = useState(null);
  const [parsed,  setParsed]  = useState(null); // { headers, preview, detected_mapping, temp_path }
  const [mapping, setMapping] = useState({});   // { csvCol: systemField }
  const [mode,    setMode]    = useState('auto'); // 'auto' | 'manual'
  const [settings, setSettings] = useState({ campaign_id: '', list_name: '', dial_order: 'asc', dial_mode: 'simultaneous', allow_duplicates: false });
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
  const fileRef = useRef();

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setLoading(true); setError('');
    try {
      const data = await leadsAPI.parseHeaders(f);
      setParsed(data);
      setMapping(data.detected_mapping || {});
      setSettings(s => ({ ...s, list_name: f.name.replace(/\.[^.]+$/, '') }));
      setStep(2);
    } catch (err) { setError(err.error || 'Failed to parse file'); }
    finally { setLoading(false); }
  };

  const handleImport = async () => {
    if (!settings.campaign_id) { setError('Select a campaign'); return; }
    setStep(4); setLoading(true); setError('');
    try {
      const finalMapping = mode === 'auto' ? (parsed?.detected_mapping || {}) : mapping;
      const data = await leadsAPI.import(null, settings.campaign_id, {
        temp_path:      parsed?.temp_path,
        column_mapping: finalMapping,
        list_name:      settings.list_name,
        dial_order:     settings.dial_order,
        dial_mode:      settings.dial_mode,
        allow_duplicates: settings.allow_duplicates,
      });
      setResult(data);
    } catch (err) { setError(err.error || 'Import failed'); setStep(3); }
    finally { setLoading(false); }
  };

  const setMapCol = (csvCol, sysField) => {
    setMapping(prev => {
      const next = { ...prev };
      // Remove existing mapping for this system field
      for (const [k,v] of Object.entries(next)) { if (v === sysField) delete next[k]; }
      if (sysField) next[csvCol] = sysField;
      else delete next[csvCol];
      return next;
    });
  };

  const STEP_LABELS = ['Upload File', 'Map Columns', 'List Settings', 'Importing'];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3 className="modal-title">📥 Import Leads</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display:'flex', borderBottom:'2px solid var(--bg-primary)', background:'var(--bg-primary)' }}>
          {STEP_LABELS.map((l, i) => (
            <div key={i} style={{ flex:1, padding:'10px 16px', textAlign:'center', fontSize:12, fontWeight:700, color: step === i+1 ? 'var(--purple)' : step > i+1 ? 'var(--success)' : 'var(--text-secondary)', background: step === i+1 ? 'var(--bg-secondary)' : 'transparent', borderBottom: step === i+1 ? '3px solid var(--purple)' : '3px solid transparent' }}>
              {step > i+1 ? '✓ ' : `${i+1}. `}{l}
            </div>
          ))}
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div style={{ textAlign:'center', padding:'30px 20px' }}>
              <div style={{ fontSize:56, marginBottom:16, opacity:0.4 }}>📄</div>
              <div style={{ fontSize:18, fontWeight:800, marginBottom:8, color:'var(--text-primary)' }}>Upload your CSV or Excel file</div>
              <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:24 }}>We'll detect your columns automatically, or you can map them manually</div>
              <button className="btn btn-primary btn-lg" onClick={() => fileRef.current?.click()} disabled={loading}>
                {loading ? '⏳ Parsing...' : '📁 Choose File'}
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display:'none' }} onChange={e => handleFile(e.target.files[0])} />
              <div style={{ marginTop:16, fontSize:12, color:'var(--text-secondary)' }}>Supported: Excel (.xlsx/.xls), CSV, TXT</div>
            </div>
          )}

          {/* Step 2: Column mapping */}
          {step === 2 && parsed && (
            <div>
              <div style={{ display:'flex', gap:10, marginBottom:18, padding:'12px 16px', background:'var(--bg-primary)', borderRadius:'var(--radius)', border:'2px solid var(--border)' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:2 }}>File: <span style={{ color:'var(--purple)' }}>{file?.name}</span></div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)' }}>{parsed.headers?.length} columns detected · {parsed.preview?.length} preview rows</div>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button className={`btn btn-sm ${mode==='auto'?'btn-primary':'btn-secondary'}`} onClick={()=>setMode('auto')}>⚡ Auto-Detect</button>
                  <button className={`btn btn-sm ${mode==='manual'?'btn-primary':'btn-secondary'}`} onClick={()=>setMode('manual')}>🔧 Map Manually</button>
                </div>
              </div>

              {mode === 'auto' ? (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Auto-detected column mapping:</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
                    {Object.entries(parsed.detected_mapping || {}).map(([csv, sys]) => {
                      const sf = SYSTEM_FIELDS.find(f => f.key === sys);
                      return (
                        <div key={csv} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'rgba(124,58,237,0.06)', borderRadius:8, border:'2px solid rgba(124,58,237,0.2)' }}>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-secondary)', flex:1 }}>{csv}</span>
                          <span style={{ fontSize:12 }}>→</span>
                          <span style={{ fontSize:12, fontWeight:700, color:'var(--purple)' }}>{sf?.label || sys}</span>
                        </div>
                      );
                    })}
                  </div>
                  {Object.keys(parsed.detected_mapping || {}).length === 0 && (
                    <div className="alert alert-error">⚠ No columns auto-detected. Please switch to Manual mapping.</div>
                  )}
                  {!Object.values(parsed.detected_mapping || {}).includes('phone') && (
                    <div className="alert alert-error">⚠ Phone column not detected. Switch to Manual to map it.</div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:12 }}>Map each CSV column to a system field:</div>
                  <table style={{ marginBottom:16 }}>
                    <thead><tr><th>CSV Column</th><th>Sample Values</th><th>Maps To</th></tr></thead>
                    <tbody>
                      {(parsed.headers || []).map(col => (
                        <tr key={col}>
                          <td><span style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600 }}>{col}</span></td>
                          <td style={{ fontSize:11, color:'var(--text-secondary)' }}>{parsed.preview?.slice(0,2).map(r => r[col]).filter(Boolean).join(', ') || '—'}</td>
                          <td>
                            <select className="select" style={{ width:180 }} value={mapping[col] || ''}
                              onChange={e => setMapCol(col, e.target.value)}>
                              <option value="">— Skip this column —</option>
                              {SYSTEM_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                              <option value="__custom__">Keep as custom field</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Preview table */}
              {parsed.preview?.length > 0 && (
                <details style={{ marginTop:10 }}>
                  <summary style={{ cursor:'pointer', fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:8 }}>📋 Preview first {parsed.preview.length} rows</summary>
                  <div style={{ overflow:'auto', maxHeight:150, border:'1px solid var(--border)', borderRadius:6 }}>
                    <table style={{ fontSize:11 }}>
                      <thead><tr>{(parsed.headers || []).map(h => <th key={h}>{h}</th>)}</tr></thead>
                      <tbody>{parsed.preview.map((r,i) => <tr key={i}>{(parsed.headers||[]).map(h => <td key={h}>{r[h]||'—'}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Step 3: List settings */}
          {step === 3 && (
            <div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Campaign *</label>
                  <select className="select" value={settings.campaign_id} onChange={e => setSettings(s=>({...s,campaign_id:e.target.value}))}>
                    <option value="">— Select campaign —</option>
                    {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">List Name</label>
                  <input className="input" value={settings.list_name} onChange={e => setSettings(s=>({...s,list_name:e.target.value}))} placeholder="e.g. June Campaign Data" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Dial Order</label>
                  <select className="select" value={settings.dial_order} onChange={e => setSettings(s=>({...s,dial_order:e.target.value}))}>
                    <option value="asc">↑ Ascending (oldest first)</option>
                    <option value="desc">↓ Descending (newest first)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">If Multiple Lists Active</label>
                  <select className="select" value={settings.dial_mode} onChange={e => setSettings(s=>({...s,dial_mode:e.target.value}))}>
                    <option value="simultaneous">🔀 Simultaneous (mix all lists)</option>
                    <option value="sequential">➡ Sequential (finish one, then next)</option>
                  </select>
                </div>
              </div>
              <label style={{ display:'flex', alignItems:'flex-start', gap:10, cursor:'pointer', marginTop:6, padding:'12px 14px', background:'var(--bg-primary)', borderRadius:10, border:'1px solid var(--border)' }}>
                <input type="checkbox" checked={settings.allow_duplicates} onChange={e => setSettings(s=>({...s, allow_duplicates: e.target.checked}))} style={{ marginTop:3 }} />
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>
                  <span style={{ fontWeight:700, color:'var(--text-primary)' }}>Allow duplicate numbers</span><br/>
                  By default, numbers already in this campaign (or repeated in the file) are skipped. Tick this to import them anyway.
                </span>
              </label>
            </div>
          )}

          {/* Step 4: Importing / result */}
          {step === 4 && (
            <div style={{ textAlign:'center', padding:'30px 20px' }}>
              {loading ? (
                <>
                  <div style={{ fontSize:48, marginBottom:16, animation:'spin 2s linear infinite', display:'inline-block' }}>⏳</div>
                  <div style={{ fontSize:18, fontWeight:800, color:'var(--text-primary)' }}>Importing leads...</div>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', marginTop:8 }}>This may take a moment for large files</div>
                </>
              ) : result ? (
                <>
                  <div style={{ fontSize:48, marginBottom:16 }}>✅</div>
                  <div style={{ fontSize:20, fontWeight:900, color:'var(--success)', marginBottom:16 }}>Import Complete!</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
                    {[['Imported', result.imported, 'var(--success)'],[result.allowDuplicates ? 'Duplicates (added)' : 'Duplicates', result.duplicates, result.allowDuplicates ? 'var(--success)' : 'var(--warning)'],['DNC Skipped', result.dnc_skipped, 'var(--danger)'],['Invalid', result.skipped, 'var(--text-secondary)']].map(([l,v,c]) => (
                      <div key={l} style={{ padding:14, background:'var(--bg-primary)', borderRadius:10, textAlign:'center' }}>
                        <div style={{ fontSize:28, fontWeight:900, color:c, fontFamily:'var(--font-mono)' }}>{v}</div>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginTop:2 }}>{l}</div>
                      </div>
                    ))}
                  </div>
                  <button className="btn btn-primary btn-lg" onClick={() => { onImported(); onClose(); }}>Done</button>
                </>
              ) : error && (
                <div className="alert alert-error">{error}</div>
              )}
            </div>
          )}
        </div>

        {step < 4 && (
          <div className="modal-footer">
            {step > 1 && step < 4 && <button className="btn btn-secondary" onClick={() => setStep(s => s-1)}>← Back</button>}
            {step === 2 && <button className="btn btn-primary" onClick={() => setStep(3)}>Next: Settings →</button>}
            {step === 3 && <button className="btn btn-primary" onClick={handleImport} disabled={!settings.campaign_id}>🚀 Import Now</button>}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main Lead Lists Page ─────────────────────────────────────────────────────
export default function LeadLists() {
  const [lists, setLists]         = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [filter, setFilter]       = useState('');
  const [unlistedCount, setUnlistedCount] = useState({});
  const [assigningCampaign, setAssigning] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, c] = await Promise.all([leadListsAPI.list(), campaignsAPI.list()]);
      setLists(l || []);
      setCampaigns(c || []);
      // Check unlisted leads per campaign
      const counts = {};
      for (const camp of (c || [])) {
        try {
          const r = await leadListsAPI.unlistedCount(camp.id);
          if (r.count > 0) counts[camp.id] = r.count;
        } catch (_) {}
      }
      setUnlistedCount(counts);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (list) => {
    await leadListsAPI.update(list.id, { active: !list.active }).catch(console.error);
    setLists(prev => prev.map(l => l.id === list.id ? { ...l, active: !l.active } : l));
  };

  const handleDelete = async (list) => {
    if (!window.confirm(`Delete "${list.name}" and ALL ${list.lead_count} leads in it? This cannot be undone.`)) return;
    await leadListsAPI.delete(list.id);
    setLists(prev => prev.filter(l => l.id !== list.id));
  };

  // Download the list's leads as CSV. Must fetch WITH the auth token — a plain
  // <a href> link opens the URL without the Authorization header, so the API
  // returns 401 and the browser saves the error as "download.json".
  const handleDownload = async (list) => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(leadListsAPI.download(list.id), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      let filename = `${list.name || `list_${list.id}`}`;
      const cd = res.headers.get('Content-Disposition');
      const m = cd && cd.match(/filename="?([^"]+)"?/);
      if (m) filename = m[1];
      // The endpoint returns CSV — force a .csv extension so it opens cleanly.
      filename = filename.replace(/\.[^.]+$/, '') + '.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
  };

  const handleDialOrder = async (id, val) => {
    await leadListsAPI.update(id, { dial_order: val });
    setLists(prev => prev.map(l => l.id === id ? { ...l, dial_order: val } : l));
  };

  const handleDialMode = async (id, val) => {
    await leadListsAPI.update(id, { dial_mode: val });
    setLists(prev => prev.map(l => l.id === id ? { ...l, dial_mode: val } : l));
  };

  const handleAssignUnlisted = async (campaignId) => {
    setAssigning(campaignId);
    try {
      await leadListsAPI.assignUnlisted(campaignId);
      await load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setAssigning(null); }
  };

  const filtered = lists.filter(l => !filter || l.name.toLowerCase().includes(filter.toLowerCase()) || l.campaign_name?.toLowerCase().includes(filter.toLowerCase()));
  const grouped = {};
  filtered.forEach(l => { if (!grouped[l.campaign_id]) grouped[l.campaign_id] = []; grouped[l.campaign_id].push(l); });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">📋 Lead Lists</h1>
          <p className="page-subtitle">Manage uploaded data batches — activate, reorder, download, recycle</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowImport(true)}>↑ Import New List</button>
      </div>

      {/* Unlisted leads banners */}
      {Object.entries(unlistedCount).map(([cid, count]) => {
        const camp = campaigns.find(c => String(c.id) === String(cid));
        return (
          <div key={cid} className="alert" style={{ background:'rgba(245,158,11,0.08)', border:'2px solid rgba(245,158,11,0.3)', color:'var(--warning)', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
            <span>⚠ <strong>{count.toLocaleString()} leads</strong> in <strong>{camp?.name || `Campaign ${cid}`}</strong> are not assigned to any list.</span>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-sm btn-warning" disabled={assigningCampaign === parseInt(cid)} onClick={() => handleAssignUnlisted(parseInt(cid))}>
                {assigningCampaign === parseInt(cid) ? '...' : '📦 Group into Default List'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setUnlistedCount(u => { const n = {...u}; delete n[cid]; return n; })}>Dismiss</button>
            </div>
          </div>
        );
      })}

      <div className="filter-bar">
        <input className="input" style={{ width:280 }} placeholder="Search lists..." value={filter} onChange={e => setFilter(e.target.value)} />
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ padding:50, textAlign:'center', color:'var(--text-secondary)' }}>Loading lists...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-text">No lead lists yet</div>
          <div className="empty-sub">Import your first CSV to create a lead list</div>
          <button className="btn btn-primary" style={{ marginTop:16 }} onClick={() => setShowImport(true)}>↑ Import Now</button>
        </div>
      ) : (
        Object.entries(grouped).map(([cid, campLists]) => {
          const camp = campaigns.find(c => String(c.id) === String(cid));
          return (
            <div key={cid} style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--purple)', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
                🎯 {camp?.name || `Campaign ${cid}`}
                <span style={{ fontSize:11, padding:'2px 8px', borderRadius:100, background:'rgba(124,58,237,0.1)', fontWeight:600, textTransform:'none', letterSpacing:0 }}>
                  {campLists.length} list{campLists.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {campLists.map(list => {
                  const pct = list.lead_count > 0 ? Math.round(((list.dialed_count||0) / list.lead_count) * 100) : 0;
                  return (
                    <div key={list.id} style={{
                      background:'var(--bg-card)', border:'2px solid var(--border)', borderRadius:'var(--radius-lg)',
                      padding:16, opacity: list.active ? 1 : 0.6,
                      borderLeft: `4px solid ${list.active ? 'var(--success)' : 'var(--text-muted)'}`,
                      transition:'all 0.2s'
                    }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                        {/* Info */}
                        <div style={{ flex:1, minWidth:200 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                            <span style={{ fontWeight:800, fontSize:15, color:'var(--text-primary)' }}>{list.name}</span>
                            <span style={{ padding:'2px 8px', borderRadius:100, fontSize:10, fontWeight:800, background: list.active?'rgba(16,185,129,0.12)':'rgba(100,116,139,0.15)', color: list.active?'var(--success)':'var(--text-secondary)' }}>
                              {list.active ? '● ACTIVE' : '○ INACTIVE'}
                            </span>
                          </div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:8 }}>
                            {list.original_filename && <span style={{ marginRight:12 }}>📄 {list.original_filename}</span>}
                            <span style={{ marginRight:12 }}>📅 {new Date(list.created_at).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})}</span>
                          </div>
                          {/* Progress */}
                          <div style={{ display:'flex', gap:16, marginBottom:10, flexWrap:'wrap' }}>
                            {[['Total',list.lead_count,'var(--text-primary)'],['New',list.new_count,'var(--info)'],['Dialed',list.dialed_count,'var(--warning)']].map(([l,v,c]) => (
                              <div key={l} style={{ textAlign:'center' }}>
                                <div style={{ fontFamily:'var(--font-mono)', fontSize:20, fontWeight:800, color:c }}>{(v||0).toLocaleString()}</div>
                                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{l}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ marginBottom:6 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-secondary)', marginBottom:3 }}>
                              <span>Progress</span><span style={{ fontWeight:700 }}>{pct}% dialed</span>
                            </div>
                            <div style={{ height:6, background:'var(--bg-primary)', borderRadius:100, overflow:'hidden' }}>
                              <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg,var(--purple),var(--pink))', borderRadius:100, transition:'width 0.5s' }} />
                            </div>
                          </div>
                        </div>

                        {/* Settings */}
                        <div style={{ display:'flex', flexDirection:'column', gap:8, minWidth:200 }}>
                          <div>
                            <div className="form-label" style={{ marginBottom:4 }}>Dial Order</div>
                            <select className="select" style={{ height:32 }} value={list.dial_order||'asc'} onChange={e => handleDialOrder(list.id, e.target.value)}>
                              <option value="asc">↑ Ascending</option>
                              <option value="desc">↓ Descending</option>
                            </select>
                          </div>
                          <div>
                            <div className="form-label" style={{ marginBottom:4 }}>Multi-list Mode</div>
                            <select className="select" style={{ height:32 }} value={list.dial_mode||'simultaneous'} onChange={e => handleDialMode(list.id, e.target.value)}>
                              <option value="simultaneous">🔀 Simultaneous</option>
                              <option value="sequential">➡ Sequential</option>
                            </select>
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          <button className={`btn btn-sm ${list.active ? 'btn-secondary' : 'btn-success'}`} onClick={() => handleToggle(list)}>
                            {list.active ? '⏸ Deactivate' : '▶ Activate'}
                          </button>
                          <button className="btn btn-sm btn-secondary" style={{ width:'100%' }} onClick={() => handleDownload(list)}>↓ Download</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(list)}>🗑 Delete</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {showImport && <ImportWizard campaigns={campaigns} onImported={load} onClose={() => setShowImport(false)} />}
    </div>
  );
}