import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { adminAPI } from '../services/api';
import api from '../services/api';
import AudioPlayer from '../components/AudioPlayer';

// ── SIP Providers Tab (multi-provider) ────────────────────────────────────────
function SipProviderTab() {
  const [trunks, setTrunks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);   // null | {} (new) | trunk (edit)
  const [tests, setTests]     = useState({});       // { [id]: { testing, ok, status, detail } }

  const load = useCallback(() => {
    setLoading(true);
    adminAPI.sipTrunks().then(d => setTrunks(d || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async t => {
    if (!window.confirm(`Delete provider "${t.name}"? Campaigns using it will fall back to the default provider.`)) return;
    try { await adminAPI.deleteTrunk(t.id); load(); }
    catch (err) { alert(err.error || 'Delete failed'); }
  };

  const handleTest = async t => {
    setTests(s => ({ ...s, [t.id]: { testing: true } }));
    try {
      const r = await adminAPI.testTrunk(t.id);
      setTests(s => ({ ...s, [t.id]: { testing: false, ...r } }));
    } catch (err) {
      setTests(s => ({ ...s, [t.id]: { testing: false, ok: false, status: 'Test failed', detail: err.error || 'Could not reach backend' } }));
    }
  };

  const makeDefault = async t => {
    try { await adminAPI.updateTrunk(t.id, { ...t, is_default: true }); load(); }
    catch (err) { alert(err.error || 'Failed'); }
  };

  const cliList = clis => (clis || '').split('\n').map(s => s.trim()).filter(Boolean);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'var(--text-primary)' }}>SIP Providers</div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>
            Add one or more carriers (Default Provider, Pinevox…). Each campaign picks which provider carries its calls.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({})}>+ Add Provider</button>
      </div>

      {loading ? (
        <div style={{ padding:30, textAlign:'center', color:'var(--text-secondary)' }}>Loading providers…</div>
      ) : trunks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📡</div>
          <div className="empty-text">No SIP providers yet</div>
          <div className="empty-sub">Add your carrier (e.g. Default Provider) to start making calls</div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {trunks.map(t => {
            const authUserpass = t.auth_type === 'userpass' || (!!t.username && t.auth_type !== 'ip');
            const test = tests[t.id];
            const clis = cliList(t.clis);
            const readonly = !!t._readonly;
            const cliShown = readonly ? (t.cid_cli_count || 0) : clis.length;
            return (
              <div key={t.id} style={{ border:'2px solid var(--border)', borderRadius:'var(--radius-lg)', padding:16, background:'var(--bg-secondary)', display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:800, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:8 }}>
                      {t.name}
                      {!!t.is_default && <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:100, background:'rgba(124,58,237,0.12)', color:'var(--purple)', border:'1px solid rgba(124,58,237,0.3)' }}>DEFAULT</span>}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-secondary)', fontFamily:'var(--font-mono)', marginTop:3 }}>{readonly ? 'Shared carrier — managed by HQ' : `${t.host}:${t.port}`}</div>
                  </div>
                  <span style={{ fontSize:11, fontWeight:700, color: t.active ? 'var(--success)' : 'var(--text-muted)' }}>
                    {t.active ? '● Active' : '○ Inactive'}
                  </span>
                </div>

                <div style={{ display:'flex', gap:8, flexWrap:'wrap', fontSize:11 }}>
                  <span style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>{authUserpass ? '🔑 User/Pass' : '🔒 IP auth'}</span>
                  <span style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>{t.codec}</span>
                  <span style={{ padding:'2px 8px', borderRadius:4, background:'var(--bg-tertiary)', color:'var(--text-secondary)' }}>{cliShown} CLI{cliShown!==1?'s':''}</span>
                </div>

                {clis.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {clis.slice(0,6).map((n,i) => (
                      <span key={i} style={{ padding:'2px 8px', borderRadius:100, fontSize:11, fontFamily:'var(--font-mono)', background:'rgba(124,58,237,0.07)', color:'var(--purple)', border:'1px solid rgba(124,58,237,0.18)' }}>{n}</span>
                    ))}
                    {clis.length > 6 && <span style={{ fontSize:11, color:'var(--text-muted)' }}>+{clis.length-6} more</span>}
                  </div>
                )}

                {/* Test result */}
                {test && !test.testing && (
                  <div style={{ fontSize:12, padding:'7px 10px', borderRadius:'var(--radius)', background: test.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border:`1px solid ${test.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`, color: test.ok ? 'var(--success)' : 'var(--danger,#ef4444)' }}>
                    {test.ok ? '✅' : '❌'} <strong>{test.status}</strong>{test.detail ? <span style={{ color:'var(--text-secondary)' }}> — {test.detail}</span> : null}
                  </div>
                )}

                {readonly ? (
                  <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:'auto', padding:'6px 0', lineHeight:1.5 }}>🔒 Shared default — managed by HQ<br/>Your caller IDs live in <strong style={{ color:'var(--text-secondary)' }}>CID Groups</strong> — that's what stamps the outbound number.</div>
                ) : (
                <div style={{ display:'flex', gap:6, marginTop:'auto', flexWrap:'wrap' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => handleTest(t)} disabled={test?.testing}>
                    {test?.testing ? '⏳ Testing…' : '🔌 Test Connection'}
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setModal(t)}>Edit</button>
                  {!t.is_default && <button className="btn btn-sm btn-secondary" onClick={() => makeDefault(t)}>Set Default</button>}
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t)} disabled={!!t.is_default} title={t.is_default ? 'Cannot delete the default provider' : 'Delete'}>Del</button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ margin:'22px 0 0', padding:'12px 16px', background:'var(--bg-primary)', border:'2px solid var(--border)', borderRadius:'var(--radius-lg)', fontSize:12, color:'var(--text-secondary)' }}>
        Saving a provider rewrites <code style={{ background:'var(--bg-tertiary)', padding:'1px 6px', borderRadius:4 }}>pjsip.conf</code> with all active trunks and reloads Asterisk via AMI. The <strong>default</strong> provider also serves manual dials and any campaign with no provider chosen.
      </div>

      {modal !== null && (
        <TrunkModal
          trunk={modal.id ? modal : null}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function RecordingsTab() {
  const [recordings, setRecordings] = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [filters, setFilters]       = useState({ search: '', date_from: '', date_to: '', agent_id: '' });
  const [agents, setAgents]         = useState([]);

  useEffect(() => {
    api.get('/agents').then(d => setAgents(d || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      if (filters.search)    params.search    = filters.search;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to)   params.date_to   = filters.date_to;
      if (filters.agent_id)  params.agent_id  = filters.agent_id;
      const data = await api.get('/calls/recordings/list', { params });
      setRecordings(data.recordings || []);
      setTotal(data.total || 0);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [page, filters]);

  useEffect(() => { load(); }, [load]);

  const setF = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };

  const fmtDur = s => s ? `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}` : '—';

  return (
    <div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16, alignItems:'flex-end' }}>
        <div>
          <div className="form-label" style={{ marginBottom:4 }}>Search (name / phone / agent)</div>
          <input className="input" style={{ width:260 }} placeholder="Search recordings..." value={filters.search} onChange={e => setF('search', e.target.value)} />
        </div>
        <div>
          <div className="form-label" style={{ marginBottom:4 }}>Agent</div>
          <select className="select" style={{ width:180 }} value={filters.agent_id} onChange={e => setF('agent_id', e.target.value)}>
            <option value="">All Agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.full_name} (EXT {a.extension})</option>)}
          </select>
        </div>
        <div>
          <div className="form-label" style={{ marginBottom:4 }}>From</div>
          <input className="input" type="date" style={{ width:150 }} value={filters.date_from} onChange={e => setF('date_from', e.target.value)} />
        </div>
        <div>
          <div className="form-label" style={{ marginBottom:4 }}>To</div>
          <input className="input" type="date" style={{ width:150 }} value={filters.date_to} onChange={e => setF('date_to', e.target.value)} />
        </div>
        <button className="btn btn-primary btn-sm" onClick={load}>Search</button>
        {(filters.search || filters.agent_id || filters.date_from) && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setFilters({ search:'', date_from:'', date_to:'', agent_id:'' }); setPage(1); }}>Clear</button>
        )}
      </div>

      <div style={{ marginBottom:12, fontSize:13, color:'var(--text-secondary)' }}>
        {total.toLocaleString()} recording{total !== 1 ? 's' : ''} found
        {total === 0 && !loading && (
          <span style={{ marginLeft:8, color:'var(--text-muted)', fontStyle:'italic' }}>
            — Recordings are saved when "Record Calls" is enabled on a campaign and Asterisk is configured
          </span>
        )}
      </div>

      <div className="card" style={{ padding:0 }}>
        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:'var(--text-secondary)' }}>Loading recordings...</div>
        ) : recordings.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎙</div>
            <div className="empty-text">No recordings found</div>
            <div className="empty-sub">Enable "Record Calls" on a campaign and connect Asterisk to generate recordings</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Phone</th>
                <th>Lead Name</th>
                <th>Agent</th>
                <th>Campaign</th>
                <th>Disposition</th>
                <th>Duration</th>
                <th style={{ minWidth:260 }}>Recording</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map(r => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize:11, whiteSpace:'nowrap' }}>
                    {new Date(r.called_at).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                  </td>
                  <td><span className="mono" style={{ color:'var(--accent)' }}>{r.phone || '—'}</span></td>
                  <td>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td>
                    <div style={{ fontWeight:600 }}>{r.agent_name || '—'}</div>
                    <div style={{ fontSize:11, color:'var(--text-secondary)', fontFamily:'var(--font-mono)' }}>EXT {r.agent_extension || '—'}</div>
                  </td>
                  <td style={{ fontSize:12, color:'var(--text-secondary)' }}>{r.campaign_name || '—'}</td>
                  <td>
                    {r.disposition_label ? (
                      <span style={{ padding:'2px 8px', borderRadius:3, fontSize:11, fontWeight:700, background:`${r.disposition_color||'#666'}22`, color:r.disposition_color||'var(--text-secondary)' }}>
                        {r.disposition_label}
                      </span>
                    ) : <span style={{ color:'var(--text-muted)' }}>—</span>}
                  </td>
                  <td className="mono">{fmtDur(r.duration)}</td>
                  <td style={{ minWidth:260 }}>
                    <AudioPlayer callId={r.id} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 50 && (
        <div className="pagination" style={{ marginTop:12 }}>
          <button className="btn btn-secondary btn-sm" disabled={page===1} onClick={() => setPage(p => p-1)}>← Prev</button>
          <span className="page-info">Page {page} of {Math.ceil(total/50)} · {total.toLocaleString()} total</span>
          <button className="btn btn-secondary btn-sm" disabled={page*50>=total} onClick={() => setPage(p => p+1)}>Next →</button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header"><h3 className="card-title">{title}</h3></div>
      {children}
    </div>
  );
}

function TrunkModal({ trunk, onSave, onClose }) {
  const [form, setForm] = useState(trunk || {
    name: '', host: '', port: 5060, username: '', password: '',
    context: 'from-trunk', codec: 'ulaw,alaw',
    auth_type: 'ip', from_user: '', clis: '', is_default: false, active: true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Treat presence of a username as user/pass auth (covers older rows w/o auth_type).
  const authType = form.auth_type || (form.username ? 'userpass' : 'ip');

  const handleSubmit = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, auth_type: authType };
      if (authType === 'ip') { payload.username = ''; payload.password = ''; }
      if (trunk?.id) await adminAPI.updateTrunk(trunk.id, payload);
      else await adminAPI.createTrunk(payload);
      onSave();
    } catch (err) { alert(err.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const cliCount = (form.clis || '').split('\n').filter(s => s.trim()).length;
  // When the CLI list changes, keep the Default Outbound CLI in step with the
  // first CLI — unless the user typed a custom default (then leave it alone).
  const onClisChange = e => {
    const newClis = e.target.value;
    setForm(f => {
      const oldFirst = (f.clis || '').split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
      const newFirst = newClis.split('\n').map(x => x.trim()).filter(Boolean)[0] || '';
      const next = { ...f, clis: newClis };
      if (!f.from_user || f.from_user.trim() === oldFirst) next.from_user = newFirst;
      return next;
    });
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3 className="modal-title">{trunk?.id ? `Edit Provider — ${trunk.name}` : 'New SIP Provider'}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group"><label className="form-label">Provider Name *</label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Default Provider, Pinevox" required /></div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Host / Server IP *</label><input className="input" value={form.host} onChange={e => set('host', e.target.value)} placeholder="sip.your-provider.com" required /></div>
              <div className="form-group"><label className="form-label">Port</label><input className="input" type="number" value={form.port} onChange={e => set('port', parseInt(e.target.value) || 5060)} /></div>
            </div>

            {/* Auth type */}
            <div className="form-group">
              <label className="form-label">Authentication Type</label>
              <div style={{ display:'flex', gap:8, marginBottom: authType==='userpass'?12:0 }}>
                <button type="button" className={`btn btn-sm ${authType==='ip'?'btn-primary':'btn-secondary'}`}
                  onClick={() => { set('auth_type','ip'); }}>🔒 IP-Based (Trusted IP)</button>
                <button type="button" className={`btn btn-sm ${authType==='userpass'?'btn-primary':'btn-secondary'}`}
                  onClick={() => set('auth_type','userpass')}>🔑 Username + Password</button>
              </div>
              {authType === 'ip' ? (
                <div style={{ padding:'8px 12px', marginTop:8, background:'rgba(16,185,129,0.06)', border:'2px solid rgba(16,185,129,0.2)', borderRadius:'var(--radius)', fontSize:12, color:'var(--text-secondary)' }}>
                  ✅ Provider authenticates by your server IP. No username/password needed (this is what Default Provider uses).
                </div>
              ) : (
                <div className="form-row">
                  <div className="form-group"><label className="form-label">SIP Username</label><input className="input" value={form.username || ''} onChange={e => set('username', e.target.value)} /></div>
                  <div className="form-group"><label className="form-label">SIP Password</label><input className="input" type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} /></div>
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group"><label className="form-label">Codecs</label><input className="input" value={form.codec} onChange={e => set('codec', e.target.value)} placeholder="ulaw,alaw" /></div>
              <div className="form-group"><label className="form-label">Default Outbound CLI</label><input className="input" value={form.from_user || ''} onChange={e => set('from_user', e.target.value)} placeholder="auto-fills from first CLI" /><div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4 }}>Used for manual dials &amp; the trunk identity. Auto-set to your first CLI — edit to override.</div></div>
            </div>

            <div className="form-group">
              <label className="form-label">Caller IDs (CLIs) — one per line</label>
              <textarea className="textarea" rows={5} value={form.clis || ''} onChange={onClisChange}
                placeholder={'01234567890\n01234567891\n01234567892'} style={{ fontFamily:'var(--font-mono)', fontSize:13 }} />
              <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:4 }}>{cliCount} CLIs · these are this provider's valid caller IDs.</div>
            </div>

            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', marginTop:4 }}>
              <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} />
              <span style={{ fontSize:13 }}>Make this the <strong>default</strong> provider (used for manual dials & campaigns with no provider selected)</span>
            </label>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? '⏳ Saving & Reloading Asterisk...' : (trunk?.id ? 'Save Changes' : 'Create Provider')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState('sip');
  const { user } = useAuth();
  const isTenant = !!(user && user.account_id != null && user.account_id !== 1 && user.role !== 'super_admin');
  useEffect(() => { if (isTenant && activeTab === 'system') setActiveTab('sip'); }, [isTenant, activeTab]);
  const [settings, setSettings] = useState({});
  const [trunks, setTrunks] = useState([]);
  const [pauseCodes, setPauseCodes] = useState([]);
  const [trunkModal, setTrunkModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editSettings, setEditSettings] = useState({});
  const [newPause, setNewPause] = useState({ code: '', label: '', billable: false });

  const load = useCallback(async () => {
    const [s, t, p] = await Promise.all([
      adminAPI.settings(), adminAPI.sipTrunks(), adminAPI.pauseCodes()
    ]).catch(() => [{}, [], []]);
    setSettings(s || {});
    setEditSettings(Object.fromEntries(Object.entries(s || {}).map(([k, v]) => [k, v.value])));
    setTrunks(t || []);
    setPauseCodes(p || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await adminAPI.updateSettings(editSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) { alert(err.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleDeleteTrunk = async id => {
    if (!window.confirm('Delete trunk?')) return;
    await adminAPI.deleteTrunk(id); load();
  };

  const handleAddPause = async e => {
    e.preventDefault();
    await adminAPI.createPauseCode(newPause);
    setNewPause({ code: '', label: '', billable: false });
    load();
  };

  const handleDeletePause = async id => {
    await adminAPI.deletePauseCode(id); load();
  };

  const setSetting = (k, v) => setEditSettings(s => ({ ...s, [k]: v }));

  const systemKeys = ['company_name', 'timezone', 'wrapup_time', 'dial_prefix', 'max_calls_per_agent'];
  const amiKeys = ['ami_host', 'ami_port', 'ami_user', 'ami_secret', 'asterisk_host', 'asterisk_ws_port', 'asterisk_sip_port'];

  const renderSettings = () => {
    if (activeTab === 'sip')        return <SipProviderTab />;
    if (activeTab === 'recordings') return <RecordingsTab />;

    if (activeTab === 'system') return (
      <Section title="System">
        <div className="form-row">
          {systemKeys.map(k => (
            <div key={k} className="form-group">
              <label className="form-label">{settings[k]?.description || k}</label>
              <input className="input" value={editSettings[k] || ''} onChange={e => setSetting(k, e.target.value)} />
            </div>
          ))}
        </div>

        {/* Admin-configurable answering-machine hold (carrier ACD padding) */}
        <div className="form-group" style={{ maxWidth: 380, marginTop: 12 }}>
          <label className="form-label">🕑 Answering-machine hold (ACD padding)</label>
          <select className="input" value={editSettings['machine_linger_seconds'] ?? '7'}
            onChange={e => setSetting('machine_linger_seconds', e.target.value)}>
            <option value="2">2 seconds</option>
            <option value="3">3 seconds</option>
            <option value="5">5 seconds</option>
            <option value="7">7 seconds (default)</option>
            <option value="10">10 seconds</option>
            <option value="15">15 seconds</option>
            <option value="20">20 seconds (max)</option>
          </select>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
            How long a detected answering machine is held before hangup — raises the carrier's
            average call duration (ACD). Does <strong>not</strong> affect dialing speed, ratio, or agents.
            Takes effect within seconds of saving.
          </div>
        </div>
      </Section>
    );

    if (activeTab === 'trunks') return (
      <Section title="SIP Trunks">
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setTrunkModal({})}>+ Add Trunk</button>
        </div>
        {trunks.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No SIP trunks configured</div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Host</th><th>Port</th><th>Context</th><th>Codecs</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {trunks.map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="mono">{t.host}</td>
                  <td className="mono">{t.port}</td>
                  <td className="mono">{t.context}</td>
                  <td style={{ fontSize: 11 }}>{t.codec}</td>
                  <td><span style={{ fontSize: 11, color: t.active ? 'var(--success)' : 'var(--text-muted)' }}>{t.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => setTrunkModal(t)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteTrunk(t.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {trunkModal !== null && (
          <TrunkModal
            trunk={trunkModal.id ? trunkModal : null}
            onSave={() => { setTrunkModal(null); load(); }}
            onClose={() => setTrunkModal(null)}
          />
        )}
      </Section>
    );

    if (activeTab === 'pause') return (
      <Section title="Pause Codes">
        <form onSubmit={handleAddPause} style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-end' }}>
          <div><div className="form-label" style={{ marginBottom: 4 }}>Code</div>
            <input className="input" style={{ width: 100 }} value={newPause.code} onChange={e => setNewPause(p => ({ ...p, code: e.target.value.toUpperCase() }))} required />
          </div>
          <div><div className="form-label" style={{ marginBottom: 4 }}>Label</div>
            <input className="input" style={{ width: 180 }} value={newPause.label} onChange={e => setNewPause(p => ({ ...p, label: e.target.value }))} required />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 2 }}>
            <input type="checkbox" checked={newPause.billable} onChange={e => setNewPause(p => ({ ...p, billable: e.target.checked }))} />
            <span style={{ fontSize: 12 }}>Billable</span>
          </label>
          <button type="submit" className="btn btn-primary btn-sm">Add</button>
        </form>
        <table>
          <thead><tr><th>Code</th><th>Label</th><th>Billable</th><th></th></tr></thead>
          <tbody>
            {pauseCodes.map(p => (
              <tr key={p.id}>
                <td className="mono" style={{ fontWeight: 700 }}>{p.code}</td>
                <td>{p.label}</td>
                <td style={{ color: p.billable ? 'var(--success)' : 'var(--text-muted)', fontSize: 12 }}>{p.billable ? 'Yes' : 'No'}</td>
                <td><button className="btn btn-sm btn-danger" onClick={() => handleDeletePause(p.id)}>Del</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    );

    // AMI — shown in system tab
    if (activeTab === 'system') return (
      <Section title="Asterisk / AMI Configuration">
        <div className="form-row">
          {amiKeys.map(k => (
            <div key={k} className="form-group">
              <label className="form-label">{settings[k]?.description || k}</label>
              <input className="input" value={editSettings[k] || ''} onChange={e => setSetting(k, e.target.value)}
                type={k.includes('secret') ? 'password' : 'text'} />
            </div>
          ))}
        </div>
      </Section>
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">System configuration &amp; recordings</p>
        </div>
        {!['recordings','sip'].includes(activeTab) && (
          <button className="btn btn-primary" onClick={handleSaveSettings} disabled={saving}>
            {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save Settings'}
          </button>
        )}
      </div>

      <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'1px solid var(--border)' }}>
        {[
          { id:'sip',        label:'📞 SIP Providers' },
          { id:'system',     label:'⚙ System' },
          { id:'pause',      label:'⏸ Pause Codes' },
          { id:'recordings', label:'🎙 Recordings' },
        ].filter(t => !isTenant || t.id !== 'system').map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding:'9px 18px', cursor:'pointer', fontSize:13, border:'none',
            borderBottom: activeTab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
            background:'transparent',
            color: activeTab===t.id ? 'var(--accent)' : 'var(--text-secondary)',
            fontWeight: activeTab===t.id ? 700 : 500,
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {renderSettings()}
    </div>
  );
}
