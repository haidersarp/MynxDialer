import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reportsAPI, campaignsAPI, agentsAPI } from '../services/api';

function exportCSV(data, filename) {
  if (!data.length) return;
  const keys = Object.keys(data[0]);
  const csv = [keys.join(','), ...data.map(r => keys.map(k => JSON.stringify(r[k] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

export default function Reports() {
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [campaignId, setCampaignId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [summary, setSummary] = useState(null);
  const [agentReport, setAgentReport] = useState([]);
  const [campaignReport, setCampaignReport] = useState([]);
  const [callsReport, setCallsReport] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    campaignsAPI.list().then(d => setCampaigns(d || [])).catch(() => {});
    agentsAPI.list().then(d => setAgents(d || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = { date_from: dateFrom, date_to: dateTo, campaign_id: campaignId || undefined, agent_id: agentId || undefined };
    try {
      const [s, a, c, cl] = await Promise.all([
        reportsAPI.summary(params),
        reportsAPI.agent(params),
        reportsAPI.campaign(params),
        reportsAPI.calls({ ...params, limit: 200 })
      ]);
      setSummary(s);
      setAgentReport(a || []);
      setCampaignReport(c || []);
      setCallsReport(cl || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, campaignId, agentId]);

  useEffect(() => { load(); }, [load]);

  const tabs = ['summary', 'agents', 'campaigns', 'calls'];

  const fmt = n => (n || 0).toLocaleString();
  const fmtDur = secs => {
    if (!secs) return '—';
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  // Time-of-day for first login; longer h/m format for break / idle totals.
  const fmtClock = ts => { if (!ts) return '—'; try { return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  const fmtLong = secs => {
    secs = parseInt(secs) || 0;
    if (secs <= 0) return '—';
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Call center analytics</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>From</div>
            <input className="input" type="date" style={{ width: 160 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>To</div>
            <input className="input" type="date" style={{ width: 160 }} value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>Campaign</div>
            <select className="select" style={{ width: 200 }} value={campaignId} onChange={e => setCampaignId(e.target.value)}>
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>Agent</div>
            <select className="select" style={{ width: 200 }} value={agentId} onChange={e => setAgentId(e.target.value)}>
              <option value="">All Agents</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Loading...' : '↻ Run Report'}
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {activeTab === 'agents' && <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(agentReport, 'agent_report.csv')}>↓ Export CSV</button>}
            {activeTab === 'calls' && <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(callsReport, 'calls_report.csv')}>↓ Export CSV</button>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {tabs.map(t => (
          <button key={t} className={`btn btn-sm ${activeTab === t ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab(t)} style={{ textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && summary && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
            {[
              { label: 'Total Calls', val: fmt(summary.total_calls) },
              { label: 'Answered', val: fmt(summary.answered_calls), cls: 'accent' },
              { label: 'Sales', val: fmt(summary.sales), cls: 'success' },
              { label: 'Answer Rate', val: `${summary.answer_rate}%`, cls: 'info' },
              { label: 'Conversion', val: `${summary.conversion_rate}%`, cls: 'warning' }
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-label">{s.label}</div>
                <div className={`stat-value ${s.cls || ''}`} style={{ fontSize: 26 }}>{s.val}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Calls Per Hour</h3></div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={(summary.hourly || []).map(r => ({ hour: `${r.hour}:00`, total: r.total, answered: r.answered }))} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6 }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" fill="#00d4ff" name="Total" radius={[2,2,0,0]} />
                <Bar dataKey="answered" fill="#3fb950" name="Answered" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Extension</th>
                <th>First Login</th>
                <th>On Break</th>
                <th>Idle (Online)</th>
                <th>Total Calls</th>
                <th>Answered</th>
                <th>Sales</th>
                <th>Avg Duration</th>
                <th>Total Talk Time</th>
                <th>Conversion</th>
              </tr>
            </thead>
            <tbody>
              {agentReport.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.full_name}</td>
                  <td className="mono">{a.extension || '—'}</td>
                  <td className="mono">{fmtClock(a.first_login)}</td>
                  <td className="mono" style={{ color: 'var(--warning)' }}>{fmtLong(a.break_sec)}</td>
                  <td className="mono" style={{ color: 'var(--info)' }}>{fmtLong(a.idle_sec)}</td>
                  <td className="mono">{fmt(a.total_calls)}</td>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{fmt(a.answered)}</td>
                  <td className="mono" style={{ color: 'var(--success)' }}>{fmt(a.sales)}</td>
                  <td className="mono">{fmtDur(a.avg_duration)}</td>
                  <td className="mono">{fmtDur(a.total_talk_time)}</td>
                  <td className="mono">{a.answered > 0 ? ((a.sales / a.answered) * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}
              {agentReport.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'campaigns' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Method</th>
                <th>Total Calls</th>
                <th>Answered</th>
                <th>Sales</th>
                <th>Avg Duration</th>
                <th>Total Leads</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {campaignReport.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{c.dial_method}</td>
                  <td className="mono">{fmt(c.total_calls)}</td>
                  <td className="mono" style={{ color: 'var(--accent)' }}>{fmt(c.answered)}</td>
                  <td className="mono" style={{ color: 'var(--success)' }}>{fmt(c.sales)}</td>
                  <td className="mono">{fmtDur(c.avg_duration)}</td>
                  <td className="mono">{fmt(c.total_leads)}</td>
                  <td className="mono" style={{ color: 'var(--warning)' }}>{fmt(c.remaining_leads)}</td>
                </tr>
              ))}
              {campaignReport.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>No data</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'calls' && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Date/Time</th>
                <th>Phone</th>
                <th>Agent</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>Disposition</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {callsReport.map(c => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {new Date(c.called_at).toLocaleString()}
                  </td>
                  <td className="mono">{c.lead_phone || c.caller_id}</td>
                  <td>{c.agent_name || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{c.campaign_name || '—'}</td>
                  <td>
                    <span style={{ fontSize: 11, textTransform: 'capitalize', color: c.status === 'answered' ? 'var(--success)' : c.status === 'no_answer' ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.disposition_label && (
                      <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: (c.disposition_color || '#666') + '22', color: c.disposition_color || 'var(--text-secondary)' }}>
                        {c.disposition_label}
                      </span>
                    )}
                  </td>
                  <td className="mono">{fmtDur(c.duration)}</td>
                </tr>
              ))}
              {callsReport.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>No calls in this range</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
