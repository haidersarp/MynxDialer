import React, { useState, useEffect, useCallback } from 'react';
import { leadListsAPI, campaignsAPI } from '../services/api';

export default function LeadRecycle() {
  const [campaigns, setCampaigns]   = useState([]);
  const [selCampaign, setSelCampaign] = useState('');
  const [lists, setLists]           = useState([]);
  const [selList, setSelList]       = useState('');
  const [listDetail, setListDetail] = useState(null);
  const [selected, setSelected]     = useState([]); // disposition codes to recycle
  const [recycling, setRecycling]   = useState(false);
  const [result, setResult]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [delayMode, setDelayMode]   = useState('now'); // now | 3h | 6h | tomorrow | custom
  const [customHrs, setCustomHrs]   = useState(4);

  // Translate the chosen delay into seconds-from-now (server applies it to NOW()).
  const computeDelaySeconds = () => {
    switch (delayMode) {
      case '3h': return 3 * 3600;
      case '6h': return 6 * 3600;
      case 'tomorrow': {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0); // next day, 9:00 AM local
        return Math.max(0, Math.round((d.getTime() - Date.now()) / 1000));
      }
      case 'custom': return Math.max(0, Math.round((parseFloat(customHrs) || 0) * 3600));
      default: return 0; // 'now'
    }
  };

  const delayLabel = {
    now: 'immediately', '3h': 'in 3 hours', '6h': 'in 6 hours',
    tomorrow: 'tomorrow morning (~9 AM)', custom: `in ${customHrs} hour(s)`,
  }[delayMode];

  useEffect(() => {
    campaignsAPI.list().then(d => setCampaigns(d || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selCampaign) { setLists([]); setSelList(''); setListDetail(null); return; }
    leadListsAPI.list({ campaign_id: selCampaign }).then(d => { setLists(d || []); }).catch(() => {});
  }, [selCampaign]);

  const loadDetail = useCallback(async () => {
    if (!selCampaign || !selList) { setListDetail(null); return; }
    setLoading(true);
    try {
      const d = selList === 'ALL'
        ? await leadListsAPI.campaignStats(selCampaign)   // whole-campaign breakdown
        : await leadListsAPI.get(selList);                // single-list breakdown
      setListDetail(d);
    } catch (_) {}
    finally { setLoading(false); }
  }, [selList, selCampaign]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const toggleDisp = (code) => {
    setSelected(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleRecycle = async () => {
    if (!selected.length || !selList) return;
    const delaySecs = computeDelaySeconds();
    if (!window.confirm(`Recycle ${selected.length} disposition type(s)? Those leads will be reset to "New" and dialed ${delayLabel}.`)) return;
    setRecycling(true); setResult(null);
    try {
      const r = selList === 'ALL'
        ? await leadListsAPI.recycleCampaign(selCampaign, selected, delaySecs)
        : await leadListsAPI.recycle(selList, selected, delaySecs);
      setResult(r);
      setSelected([]);
      await loadDetail();
    } catch (err) { alert(err.error || 'Recycle failed'); }
    finally { setRecycling(false); }
  };

  const totalSelected = listDetail?.breakdown?.filter(d => selected.includes(d.code)).reduce((a, b) => a + (b.count || 0), 0) || 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">♻ Lead Recycle</h1>
          <p className="page-subtitle">Reset dispositioned leads back to "New" so they get redialed</p>
        </div>
      </div>

      {/* Info banner */}
      <div style={{ marginBottom:20, padding:'14px 18px', background:'rgba(124,58,237,0.06)', border:'2px solid rgba(124,58,237,0.2)', borderRadius:'var(--radius-lg)', fontSize:13, color:'var(--text-secondary)' }}>
        <strong style={{ color:'var(--purple)' }}>How it works:</strong> Select a lead list, pick which dispositions to recycle (e.g. Answering Machine, Busy, No Answer), then click Recycle. Those leads are reset to "New" status and re-added to the hopper — so they get called again without losing any data.
      </div>

      {/* Selectors */}
      <div className="card" style={{ marginBottom:20, padding:'16px 20px' }}>
        <div style={{ display:'flex', gap:16, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div className="form-label" style={{ marginBottom:6 }}>Campaign</div>
            <select className="select" value={selCampaign} onChange={e => { setSelCampaign(e.target.value); setSelList(e.target.value ? 'ALL' : ''); setListDetail(null); setSelected([]); }}>
              <option value="">— Select Campaign —</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
            </select>
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <div className="form-label" style={{ marginBottom:6 }}>Scope</div>
            <select className="select" value={selList} onChange={e => { setSelList(e.target.value); setSelected([]); setResult(null); }} disabled={!selCampaign}>
              <option value="ALL">★ Whole campaign (all leads)</option>
              {lists.map(l => <option key={l.id} value={l.id}>{l.name} ({(l.lead_count||0).toLocaleString()} leads)</option>)}
            </select>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadDetail} disabled={!selList}>↻</button>
        </div>
      </div>

      {result && (
        <div className="alert alert-success" style={{ marginBottom:20 }}>
          ✅ Successfully recycled <strong>{result.recycled}</strong> leads back to "New" status. {result.delay_seconds > 0
            ? <>They'll be held out of the dialer and start dialing <strong>{delayLabel}</strong>.</>
            : <>They'll appear in the hopper shortly.</>}
        </div>
      )}

      {loading && <div style={{ padding:30, textAlign:'center', color:'var(--text-secondary)' }}>Loading stats...</div>}

      {listDetail && !loading && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 340px', gap:20 }}>
          {/* Left: Stats + disposition selection */}
          <div>
            {/* Overview stats */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
              {[
                { l:'Total Leads',  v: listDetail.lead_count,              c:'var(--text-primary)' },
                { l:'New (Undialed)',v: listDetail.status_breakdown?.find(s=>s.status==='new')?.count || 0,     c:'var(--info)' },
                { l:'Dialed',       v: listDetail.status_breakdown?.filter(s=>!['new','callback'].includes(s.status)).reduce((a,b)=>a+(parseInt(b.count)||0),0) || 0, c:'var(--warning)' },
                { l:'Available to Recycle', v: listDetail.breakdown?.reduce((a,b)=>a+(b.count||0),0)||0, c:'var(--purple)' },
              ].map(s => (
                <div key={s.l} className="stat-card" style={{ padding:16 }}>
                  <div className="stat-label">{s.l}</div>
                  <div className="stat-value" style={{ color:s.c, fontSize:28 }}>{(s.v||0).toLocaleString()}</div>
                </div>
              ))}
            </div>

            {/* Disposition breakdown */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Select Dispositions to Recycle</h3>
                <div style={{ display:'flex', gap:8 }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => setSelected(listDetail.breakdown?.map(d=>d.code)||[])}>Select All</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>Clear</button>
                </div>
              </div>

              {(!listDetail.breakdown || listDetail.breakdown.length === 0) ? (
                <div style={{ padding:'30px 20px', textAlign:'center', color:'var(--text-secondary)' }}>
                  <div style={{ fontSize:32, marginBottom:10, opacity:0.3 }}>📭</div>
                  No dispositioned leads in this list yet
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {listDetail.breakdown.map(d => {
                    const isSel = selected.includes(d.code);
                    return (
                      <label key={d.code} style={{
                        display:'flex', alignItems:'center', gap:14, padding:'12px 16px',
                        borderRadius:'var(--radius)', cursor:'pointer',
                        background: isSel ? 'rgba(124,58,237,0.08)' : 'var(--bg-primary)',
                        border: `2px solid ${isSel ? 'var(--purple)' : 'var(--border)'}`,
                        transition:'all 0.15s'
                      }}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleDisp(d.code)}
                          style={{ width:18, height:18, accentColor:'var(--purple)', cursor:'pointer', flexShrink:0 }} />
                        <div style={{ width:12, height:12, borderRadius:'50%', background:d.color||'#666', flexShrink:0 }} />
                        <div style={{ flex:1 }}>
                          <span style={{ fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>{d.label}</span>
                          <span style={{ marginLeft:8, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-secondary)' }}>({d.code})</span>
                        </div>
                        <span style={{ fontFamily:'var(--font-mono)', fontSize:16, fontWeight:800, color: isSel ? 'var(--purple)' : 'var(--text-primary)' }}>
                          {(d.count||0).toLocaleString()}
                        </span>
                        <span style={{ fontSize:11, color:'var(--text-secondary)', minWidth:40, textAlign:'right' }}>leads</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Summary + action */}
          <div>
            <div className="card card-glow" style={{ position:'sticky', top:20 }}>
              <h3 style={{ fontWeight:800, fontSize:16, marginBottom:16, color:'var(--text-primary)' }}>♻ Recycle Summary</h3>

              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>Selected Dispositions</div>
                {selected.length === 0 ? (
                  <div style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic' }}>None selected</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {selected.map(code => {
                      const d = listDetail?.breakdown?.find(b => b.code === code);
                      return (
                        <div key={code} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:'rgba(124,58,237,0.06)', borderRadius:8 }}>
                          <span style={{ fontSize:13, fontWeight:600 }}>{d?.label || code}</span>
                          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, color:'var(--purple)', fontWeight:700 }}>{(d?.count||0).toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ padding:'14px 16px', background:'rgba(124,58,237,0.08)', borderRadius:10, marginBottom:20, textAlign:'center' }}>
                <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--purple)', marginBottom:6 }}>Leads to Recycle</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize:36, fontWeight:900, color:'var(--purple)' }}>{totalSelected.toLocaleString()}</div>
              </div>

              {/* When to dial the recycled leads */}
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.06em' }}>⏱ When to redial</div>
                <select className="select" value={delayMode} onChange={e => setDelayMode(e.target.value)}>
                  <option value="now">Dial immediately</option>
                  <option value="3h">In 3 hours</option>
                  <option value="6h">In 6 hours</option>
                  <option value="tomorrow">Tomorrow morning (~9 AM)</option>
                  <option value="custom">Custom…</option>
                </select>
                {delayMode === 'custom' && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
                    <input type="number" min="0" step="0.5" className="select" style={{ width:90 }}
                      value={customHrs} onChange={e => setCustomHrs(e.target.value)} />
                    <span style={{ fontSize:13, color:'var(--text-secondary)' }}>hours from now</span>
                  </div>
                )}
              </div>

              <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                These leads will be reset to <strong style={{ color:'var(--info)' }}>New</strong> status, attempts counter reset, and dialed <strong style={{ color:'var(--purple)' }}>{delayLabel}</strong>.
              </div>

              <button
                className="btn btn-primary btn-lg"
                style={{ width:'100%', background:'linear-gradient(135deg,var(--purple),var(--pink))' }}
                onClick={handleRecycle}
                disabled={!selected.length || recycling}
              >
                {recycling ? '⏳ Recycling...' : `♻ Recycle ${totalSelected.toLocaleString()} Leads`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}