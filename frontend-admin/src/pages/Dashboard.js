import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { reportsAPI, agentsAPI, callsAPI, campaignsAPI } from '../services/api';
import { getSocket } from '../services/socket';

const COLORS = ['#00e5ff','#ff5252','#8b949e','#ffd740','#2979ff','#00e676','#ff9100','#e040fb'];

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #ff5f6d, #fc466b)',
  'linear-gradient(135deg, #11998e, #38ef7d)',
  'linear-gradient(135deg, #4facfe, #00f2fe)',
  'linear-gradient(135deg, #a18cd1, #fbc2eb)',
  'linear-gradient(135deg, #f7971e, #ffd200)',
  'linear-gradient(135deg, #667eea, #764ba2)',
];

// Seconds → m:ss (Average Call Duration)
function fmtDur(s) {
  s = parseInt(s) || 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function KPICard({ label, value, sub, icon, gradIdx = 0 }) {
  return (
    <div className="stat-card" style={{ background: CARD_GRADIENTS[gradIdx % CARD_GRADIENTS.length] }}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function LiveCallFeed({ calls }) {
  return (
    <div style={{ maxHeight:280, overflow:'auto' }}>
      {calls.length === 0 ? (
        <div style={{ padding:'30px 16px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No recent calls</div>
      ) : calls.map((c, i) => (
        <div key={c.id || i} className="feed-item">
          <div style={{ width:8, height:8, borderRadius:'50%', background: c.status==='answered'?'var(--success)':c.status==='ringing'?'var(--warning)':'var(--text-muted)', flexShrink:0, boxShadow: c.status==='answered'?'0 0 6px var(--success)':'none' }} />
          <span style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--accent)', minWidth:120 }}>{c.lead_phone || c.caller_id || '—'}</span>
          <span style={{ flex:1, color:'var(--text-secondary)', fontSize:11 }}>{c.agent_name || '—'}</span>
          <span style={{ fontSize:11, color: c.status==='answered'?'var(--success)':c.status==='ringing'?'var(--warning)':'var(--text-muted)', fontWeight:700, textTransform:'uppercase', minWidth:70, textAlign:'right' }}>{c.status}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)', minWidth:50, textAlign:'right' }}>
            {c.duration ? `${Math.floor(c.duration/60)}:${(c.duration%60).toString().padStart(2,'0')}` : c.status==='ringing'?'…':'—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentLeaderboard({ agents }) {
  // Rank by CONNECTED calls (status='answered') so these totals reconcile with the
  // dashboard's "Answered" tile. total_calls also counts no_answer dial attempts that
  // were routed to an agent but never connected, which made the two disagree.
  const conn = a => Number(a?.answered || 0);
  const sorted = [...agents].sort((a,b) => conn(b) - conn(a)).slice(0,8);
  const maxCalls = conn(sorted[0]) || 1;
  return (
    <div>
      {sorted.map((a, i) => (
        <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom: i < sorted.length-1 ? '1px solid var(--border-dim)' : 'none' }}>
          <div style={{ width:22, height:22, borderRadius:'50%', background: i===0?'linear-gradient(135deg,#ffd740,#ff9100)':i===1?'linear-gradient(135deg,#b0bec5,#78909c)':i===2?'linear-gradient(135deg,#ff9100,#e65100)':'var(--bg-card)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color: i<3?'#000':'var(--text-muted)', flexShrink:0 }}>
            {i+1}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>{a.full_name}</span>
              <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--accent)', fontWeight:700 }}>{conn(a)} connected<span style={{ color:'var(--text-muted)', fontWeight:500 }}> · {a.total_calls||0} dials</span></span>
            </div>
            <div style={{ height:4, background:'var(--bg-input)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${(conn(a)/maxCalls)*100}%`, background: i===0?'linear-gradient(90deg,var(--warning),var(--orange))':'linear-gradient(90deg,var(--accent),var(--info))', borderRadius:2, transition:'width 0.5s' }} />
            </div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:12, fontWeight:700, color:'var(--success)' }}>{a.sales||0} 🏆</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignPerf({ campaigns }) {
  return (
    <div>
      {campaigns.slice(0,6).map(c => {
        const pct = c.total_leads > 0 ? Math.round(((c.total_leads - (c.remaining_leads||0)) / c.total_leads) * 100) : 0;
        return (
          <div key={c.id} style={{ marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background: c.status==='active'?'var(--success)':c.status==='paused'?'var(--warning)':'var(--text-muted)', display:'inline-block' }} />
                <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{c.name}</span>
              </div>
              <div style={{ display:'flex', gap:12, fontSize:11, color:'var(--text-secondary)' }}>
                <span><span style={{ color:'var(--accent)', fontFamily:'var(--font-mono)' }}>{c.answered||0}</span> answered</span>
                <span><span style={{ color:'var(--success)', fontFamily:'var(--font-mono)' }}>{c.sales||0}</span> sales</span>
                <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, color: pct>=80?'var(--success)':pct>=50?'var(--warning)':'var(--text-secondary)' }}>{pct}%</span>
              </div>
            </div>
            <div style={{ height:6, background:'var(--bg-input)', borderRadius:3, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, borderRadius:3, transition:'width 0.6s', background: c.status==='active'?'linear-gradient(90deg,var(--accent),var(--info))':'linear-gradient(90deg,var(--text-muted),var(--border))' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const [summary, setSummary]   = useState(null);
  const [agentRpt, setAgentRpt] = useState([]);
  const [campRpt, setCampRpt]   = useState([]);
  const [activeCalls, setActiveCalls] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [liveStats, setLiveStats] = useState({ active_calls:0, online_agents:0 });
  const [loading, setLoading]   = useState(true);
  const [campaignList, setCampaignList] = useState([]);
  const [campaignFilter, setCampaignFilter] = useState('');   // '' = ALL (default)
  const today = new Date().toISOString().split('T')[0];

  // Campaigns for the dashboard filter dropdown (loaded once).
  useEffect(() => { campaignsAPI.list().then(d => setCampaignList(d || [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    try {
      const cid = campaignFilter || undefined;   // undefined → ALL
      const range = { date_from:today, date_to:today };
      const [s, ar, cr, ac, rc] = await Promise.all([
        reportsAPI.summary({ ...range, campaign_id: cid }),
        reportsAPI.agent({ ...range, campaign_id: cid }),
        reportsAPI.campaign(range),
        callsAPI.active(),
        reportsAPI.calls({ ...range, limit:20 })
      ]);
      setSummary(s);
      setAgentRpt(ar || []);
      // Campaign Performance widget: show just the selected campaign when filtered.
      setCampRpt(cid ? (cr || []).filter(c => String(c.id) === String(cid)) : (cr || []));
      setActiveCalls(Array.isArray(ac) ? ac : []);
      setRecentCalls(Array.isArray(rc) ? rc : []);
      setLiveStats({ active_calls: s.active_calls||0, online_agents: s.online_agents||0 });
    } catch(err){ console.error(err); }
    finally{ setLoading(false); }
  }, [today, campaignFilter]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    const s = getSocket();
    s.on('call:started', () => setLiveStats(x => ({ ...x, active_calls: x.active_calls+1 })));
    s.on('call:hangup',  () => setLiveStats(x => ({ ...x, active_calls: Math.max(0,x.active_calls-1) })));
    s.on('agent:status', d => {
      if (['available','oncall'].includes(d.status)) setLiveStats(x => ({ ...x, online_agents: x.online_agents+1 }));
      if (d.status === 'offline') setLiveStats(x => ({ ...x, online_agents: Math.max(0,x.online_agents-1) }));
    });
    return () => { clearInterval(iv); s.off('call:started'); s.off('call:hangup'); s.off('agent:status'); };
  }, [load]);

  const hourly = Array.from({ length:24 }, (_, h) => {
    const f = summary?.hourly?.find(r => parseInt(r.hour) === h);
    return { hour:`${h}:00`, total:f?.total||0, answered:f?.answered||0 };
  });

  if (loading) return <div style={{ color:'var(--text-secondary)', padding:50, textAlign:'center', fontSize:16 }}>Loading dashboard...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{new Date().toLocaleDateString('en-US',{ weekday:'long', year:'numeric', month:'long', day:'numeric' })} — Live Operations</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <select value={campaignFilter} onChange={e => setCampaignFilter(e.target.value)}
            className="select" style={{ minWidth:170, fontSize:13 }} title="Filter the dashboard by campaign">
            <option value="">📊 All Campaigns</option>
            {campaignList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:12, marginBottom:20 }}>
        <KPICard label="Active Calls"  value={liveStats.active_calls}    icon="📞" sub="right now"                                  gradIdx={0} />
        <KPICard label="Agents Online" value={liveStats.online_agents}   icon="🎧" sub="logged in"                                  gradIdx={1} />
        <KPICard label="Calls Today"   value={summary?.total_calls||0}   icon="📈" sub="dialed"                                     gradIdx={2} />
        <KPICard label="Answered"      value={summary?.answered_calls||0}icon="✅" sub="connected"                                  gradIdx={3} />
        <KPICard label="Connection %"  value={`${summary?.answer_rate||0}%`} icon="🔗" sub="of dials answered"                     gradIdx={2} />
        <KPICard label="Dropped %"     value={`${summary?.drop_rate||0}%`}   icon="📉" sub={`${summary?.abandoned_calls||0} abandoned`} gradIdx={0} />
        <KPICard label="Avg Call Duration" value={fmtDur(summary?.avg_duration)} icon="⏱" sub="avg talk time"                      gradIdx={5} />
        <KPICard label="Sales Today"   value={summary?.sales||0}         icon="🏆" sub={`${summary?.conversion_rate||0}% conv.`}    gradIdx={4} />
      </div>

      {/* Row 2: Hourly chart + Live feed */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 380px', gap:16, marginBottom:16 }}>
        <div className="card card-glow">
          <div className="card-header">
            <h3 className="card-title">📊 Calls Per Hour — Today</h3>
            <span style={{ fontSize:11, color:'var(--text-secondary)' }}>Auto-refreshes every 15s</span>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={hourly} margin={{ top:0, right:10, left:-20, bottom:0 }}>
              <defs>
                <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00e5ff" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#00e5ff" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gAnswered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00e676" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#00e676" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,48,82,0.8)" />
              <XAxis dataKey="hour" tick={{ fill:'var(--text-secondary)', fontSize:10 }} interval={2} />
              <YAxis tick={{ fill:'var(--text-secondary)', fontSize:10 }} />
              <Tooltip contentStyle={{ background:'var(--bg-card)', border:'1px solid var(--border-glow)', borderRadius:8, color:'var(--text-primary)', boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }} />
              <Area type="monotone" dataKey="total"    stroke="#00e5ff" fill="url(#gTotal)"    name="Total"    strokeWidth={2} />
              <Area type="monotone" dataKey="answered" stroke="#00e676" fill="url(#gAnswered)" name="Answered" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card card-glow">
          <div className="card-header">
            <h3 className="card-title">
              <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--danger)', boxShadow:'0 0 8px var(--danger)', display:'inline-block' }} />
              Live Call Feed
            </h3>
            <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{activeCalls.length} active</span>
          </div>
          <LiveCallFeed calls={[...activeCalls, ...recentCalls.slice(0, Math.max(0, 8-activeCalls.length))]} />
        </div>
      </div>

      {/* Row 3: Disposition pie + Campaign performance + Agent leaderboard */}
      <div style={{ display:'grid', gridTemplateColumns:'260px 1fr 300px', gap:16, marginBottom:16 }}>
        <div className="card card-glow">
          <div className="card-header"><h3 className="card-title">🏷 Dispositions</h3></div>
          {summary?.by_disposition?.length > 0 ? (
            // Clean centred donut with the total in the middle. The legend is
            // intentionally omitted — with 15+ dispositions it overlapped the
            // chart in this narrow card; the Disposition Breakdown table below
            // lists every label with its colour, count and %.
            <div style={{ position:'relative' }}>
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={summary.by_disposition} cx="50%" cy="50%" outerRadius={82} innerRadius={50} paddingAngle={1} dataKey="count" nameKey="label">
                    {summary.by_disposition.map((e,i) => <Cell key={i} fill={e.color || COLORS[i%COLORS.length]} stroke="var(--bg-card)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background:'var(--bg-card)', border:'1px solid var(--border-glow)', borderRadius:6 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', textAlign:'center', pointerEvents:'none' }}>
                <div style={{ fontSize:24, fontWeight:800, color:'var(--text-primary)', lineHeight:1 }}>
                  {summary.by_disposition.reduce((s,d) => s + (d.count || 0), 0).toLocaleString()}
                </div>
                <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginTop:3 }}>Total Calls</div>
              </div>
            </div>
          ) : (
            <div style={{ padding:'40px 0', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>No calls today</div>
          )}
        </div>

        <div className="card card-glow">
          <div className="card-header">
            <h3 className="card-title">🎯 Campaign Performance</h3>
            <span style={{ fontSize:11, color:'var(--text-secondary)' }}>{campRpt.filter(c=>c.status==='active').length} active</span>
          </div>
          <CampaignPerf campaigns={campRpt} />
        </div>

        <div className="card card-glow">
          <div className="card-header"><h3 className="card-title">🏆 Agent Leaderboard</h3></div>
          <AgentLeaderboard agents={agentRpt} />
        </div>
      </div>

      {/* Row 4: Disposition table */}
      {summary?.by_disposition?.length > 0 && (
        <div className="card">
          <div className="card-header"><h3 className="card-title">📋 Disposition Breakdown</h3></div>
          <table>
            <thead><tr><th>Disposition</th><th>Count</th><th>% of Calls</th><th>Distribution</th></tr></thead>
            <tbody>
              {summary.by_disposition.map((d,i) => {
                const pct = summary.total_calls > 0 ? ((d.count/summary.total_calls)*100).toFixed(1) : 0;
                return (
                  <tr key={i}>
                    <td><span style={{ display:'inline-flex', alignItems:'center', gap:8 }}><span style={{ width:10, height:10, borderRadius:'50%', background:d.color||'#666', boxShadow:`0 0 6px ${d.color||'#666'}` }} />{d.label}</span></td>
                    <td><span className="mono" style={{ color:'var(--text-primary)', fontWeight:700 }}>{d.count}</span></td>
                    <td><span className="mono" style={{ color:'var(--accent)' }}>{pct}%</span></td>
                    <td style={{ width:220 }}>
                      <div style={{ background:'var(--bg-input)', borderRadius:3, height:6, overflow:'hidden' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:`linear-gradient(90deg,${d.color||'var(--accent)'},${d.color||'var(--accent)'}88)`, borderRadius:3, transition:'width 0.5s' }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
