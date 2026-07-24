import React, { useState, useEffect } from 'react';
import { adminAPI } from '../services/api';

const NOTE_TEMPLATES = [
  'Interested — follow up',
  'Called back later',
  'Not available',
  'Wrong number',
  'Already a customer',
  'Requested info by email',
  'Language barrier',
  'Voicemail left',
];

// Pretty-print a raw custom-field key like "PostTown" / "addr_1" → "Post Town".
function prettyKey(k) {
  return String(k)
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function InfoTab({ lead, fields, set, campaignName, callState, customFields }) {
  // Show EVERY extra column from the imported sheet (Addr1, Forename, Postcode,
  // PostTown, …) so the agent always sees the full record for the dialed number,
  // regardless of how the columns were mapped on import.
  const extra = Object.entries(customFields || {}).filter(([k, v]) =>
    v !== null && v !== undefined && String(v).trim() !== '' &&
    !['notes'].includes(String(k).toLowerCase())
  );
  return (
    <div style={{ padding:'10px 12px', overflow:'auto', flex:1 }}>
      {/* Lead meta */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'4px 12px', marginBottom:12, padding:'8px 10px', background:'var(--bg-input)', borderRadius:'var(--r)', border:'1px solid var(--border-dim)' }}>
        {[
          { l:'Lead ID',      v: lead.id,        accent:true },
          { l:'Called Count', v: lead.attempts },
          { l:'List Name',    v: campaignName },
          { l:'Recording',    v: callState?.id ? `CALL-${callState.id}` : '—' }
        ].map(f => (
          <div key={f.l}>
            <div className="lbl">{f.l}</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:700, color: f.accent ? 'var(--cyan)' : 'var(--text)' }}>{f.v || '—'}</div>
          </div>
        ))}
      </div>

      {/* Phone — prominent */}
      <div style={{ padding:'10px 14px', background:'linear-gradient(135deg,rgba(0,229,255,0.06),rgba(41,121,255,0.06))', borderRadius:'var(--r2)', border:'1px solid var(--border-glow)', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <div className="lbl">Phone Number</div>
          <div style={{ fontFamily:'var(--mono)', fontSize:22, fontWeight:800, color:'var(--cyan)', letterSpacing:3 }}>{lead.phone}</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div className="lbl">Alt Phone</div>
          <div style={{ fontFamily:'var(--mono)', fontSize:14, fontWeight:600, color:'var(--text2)' }}>{fields.alt_phone || '—'}</div>
        </div>
      </div>

      <div style={{ height:1, background:'var(--border-dim)', marginBottom:10 }} />

      {/* Name */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 80px', gap:'4px 10px', marginBottom:8 }}>
        {[['First Name','first_name'],['Last Name','last_name'],['Title','title']].map(([l,k]) => (
          <div key={k}><div className="lbl">{l}</div><div className="fv"><input value={fields[k]||''} onChange={e => set(k)(e.target.value)} /></div></div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 10px', marginBottom:8 }}>
        {[['Middle Initial','middle_initial'],['Date of Birth','dob'],['Email','email'],['Alt Phone','alt_phone']].map(([l,k]) => (
          <div key={k}><div className="lbl">{l}</div><div className="fv"><input value={fields[k]||''} onChange={e => set(k)(e.target.value)} /></div></div>
        ))}
      </div>

      <div style={{ height:1, background:'var(--border-dim)', marginBottom:8 }} />

      {/* Address */}
      <div style={{ marginBottom:8 }}><div className="lbl">Address 1</div><div className="fv"><input value={fields.address||''} onChange={e => set('address')(e.target.value)} /></div></div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 10px', marginBottom:8 }}>
        {[['Address 2','address2'],['Address 3','address3']].map(([l,k]) => (
          <div key={k}><div className="lbl">{l}</div><div className="fv"><input value={fields[k]||''} onChange={e => set(k)(e.target.value)} /></div></div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 80px 80px', gap:'4px 10px', marginBottom:8 }}>
        {[['City','city'],['State','state'],['Zip','zip'],['Province','province']].map(([l,k]) => (
          <div key={k}><div className="lbl">{l}</div><div className="fv"><input value={fields[k]||''} onChange={e => set(k)(e.target.value)} /></div></div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 10px', marginBottom:8 }}>
        {[['Phone Code','phone_code'],['Vendor Lead Code','vendor_lead_code']].map(([l,k]) => (
          <div key={k}><div className="lbl">{l}</div><div className="fv"><input value={fields[k]||''} style={{ fontFamily:'var(--mono)' }} onChange={e => set(k)(e.target.value)} /></div></div>
        ))}
      </div>

      {/* All extra columns from the imported sheet for THIS lead */}
      {extra.length > 0 && (
        <>
          <div style={{ height:1, background:'var(--border-dim)', margin:'4px 0 8px' }} />
          <div className="lbl" style={{ marginBottom:6, color:'var(--cyan)' }}>📄 Lead Data (from imported list)</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 12px' }}>
            {extra.map(([k, v]) => (
              <div key={k} style={{ background:'var(--bg-input)', borderRadius:'var(--r)', border:'1px solid var(--border-dim)', padding:'5px 8px' }}>
                <div className="lbl">{prettyKey(k)}</div>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', wordBreak:'break-word' }}>{String(v)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryTab({ lead }) {
  const calls = lead?.call_history || [];
  const statusColors = { answered:'var(--green)', no_answer:'var(--text2)', busy:'var(--yellow)', failed:'var(--red)' };

  if (!calls.length) return (
    <div style={{ padding:30, textAlign:'center', color:'var(--muted)' }}>
      <div style={{ fontSize:32, opacity:0.2, marginBottom:8 }}>📞</div>
      No previous call history
    </div>
  );

  return (
    <div style={{ padding:'10px 12px' }}>
      {calls.map((c, i) => (
        <div key={c.id} style={{ display:'flex', gap:12, paddingBottom:12, marginBottom: i < calls.length-1 ? 12 : 0, borderBottom: i < calls.length-1 ? '1px solid var(--border-dim)' : 'none' }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0 }}>
            <div style={{ width:10, height:10, borderRadius:'50%', background: statusColors[c.status] || 'var(--text2)', boxShadow:`0 0 8px ${statusColors[c.status] || 'transparent'}` }} />
            {i < calls.length-1 && <div style={{ width:1, flex:1, background:'var(--border-dim)', marginTop:4 }} />}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'var(--text)' }}>{c.agent_name || 'Unknown Agent'}</span>
              <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--muted)' }}>
                {new Date(c.called_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
              </span>
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              {c.disposition_label ? (
                <span style={{ padding:'2px 8px', borderRadius:3, background:( c.disposition_color||'#666')+'22', color: c.disposition_color||'var(--text2)', fontSize:11, fontWeight:700 }}>
                  {c.disposition_label}
                </span>
              ) : <span style={{ fontSize:11, color:'var(--muted)' }}>No disposition</span>}
              <span style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text2)' }}>
                {c.duration ? `${Math.floor(c.duration/60)}:${(c.duration%60).toString().padStart(2,'0')}` : '—'}
              </span>
              <span style={{ fontSize:11, color: statusColors[c.status]||'var(--text2)', textTransform:'capitalize' }}>{c.status}</span>
            </div>
            {c.notes && <div style={{ fontSize:11, color:'var(--text2)', marginTop:4, fontStyle:'italic', paddingLeft:8, borderLeft:'2px solid var(--border)' }}>{c.notes}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotesTab({ notes, setNotes, lead, onDNC }) {
  return (
    <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
      <div>
        <div className="lbl" style={{ marginBottom:6 }}>Quick Templates</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
          {NOTE_TEMPLATES.map(t => (
            <button key={t} className="tpl-btn" onClick={() => setNotes(n => n ? n + '\n' + t : t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="lbl" style={{ marginBottom:5 }}>Call Notes</div>
        <textarea className="ta" rows={6} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Enter call notes here..." style={{ resize:'none', minHeight:120 }} />
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex:1 }} onClick={() => setNotes('')}>Clear</button>
        <button className="btn btn-red btn-sm" style={{ flex:1 }} onClick={onDNC} disabled={!lead}>
          🚫 Add to DNC
        </button>
      </div>

      {lead && (
        <div style={{ padding:'8px 10px', background:'rgba(0,229,255,0.04)', borderRadius:'var(--r)', border:'1px solid var(--border-dim)', fontSize:11, color:'var(--text2)' }}>
          Lead <span style={{ color:'var(--cyan)', fontFamily:'var(--mono)' }}>#{lead.id}</span> · Status: <span style={{ color:'var(--text)', textTransform:'capitalize' }}>{lead.status}</span> · Attempts: <span style={{ color:'var(--yellow)', fontFamily:'var(--mono)' }}>{lead.attempts}</span>
        </div>
      )}
    </div>
  );
}

export default function CustomerDetails({ lead, callState, campaignName }) {
  const [tab, setTab] = useState('info');
  const [fields, setFields] = useState({});
  const [customFields, setCustomFields] = useState({});
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!lead) { setFields({}); setCustomFields({}); setNotes(''); setTab('info'); return; }
    const cf = (() => { try { return typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : (lead.custom_fields || {}); } catch { return {}; } })();
    setCustomFields(cf);
    setFields({
      first_name: lead.first_name || '', last_name: lead.last_name || '',
      email: lead.email || '', address: lead.address || '', city: lead.city || '',
      state: lead.state || '', zip: lead.zip || '', phone: lead.phone || '',
      alt_phone: cf.alt_phone || cf.alt_number || '',
      dob: cf.dob || cf.date_of_birth || '', title: cf.title || '',
      middle_initial: cf.middle_initial || '', address2: cf.address2 || '',
      address3: cf.address3 || '', province: cf.province || '',
      vendor_lead_code: cf.vendor_lead_code || '', phone_code: cf.phone_code || ''
    });
    setNotes(cf.notes || '');
  }, [lead]);

  const set = k => v => setFields(f => ({ ...f, [k]: v }));

  const handleDNC = async () => {
    if (!lead || !window.confirm(`Add ${lead.phone} to DNC list?`)) return;
    const token = localStorage.getItem('agent_token');
    await fetch('/api/admin/dnc', { method:'POST', headers: { 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ phone: lead.phone, reason: 'Agent request' }) });
    alert('Added to DNC list');
  };

  return (
    <div className="panel" style={{ flex:1 }}>
      <div className="panel-hdr panel-hdr-blue" style={{ paddingTop:0, paddingBottom:0, height:36 }}>
        <span>Customer Details</span>
        {lead && (
          <div style={{ display:'flex', gap:10, fontSize:10 }}>
            <span style={{ color:'var(--text2)' }}>LIST: <strong style={{ color:'var(--cyan)' }}>{campaignName||'—'}</strong></span>
            <span style={{ color:'var(--text2)' }}>CALLS: <strong style={{ color:'var(--text)' }}>{lead.attempts||0}</strong></span>
            {lead.last_disposition && <span style={{ color:'var(--text2)' }}>LAST: <strong style={{ color:'var(--yellow)' }}>{lead.last_disposition}</strong></span>}
          </div>
        )}
      </div>

      {!lead ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, color:'var(--muted)' }}>
          <div style={{ width:72, height:72, borderRadius:'50%', background:'var(--bg-elevated)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, opacity:0.3 }}>👤</div>
          <div style={{ fontSize:16, fontWeight:600, color:'var(--text2)' }}>Waiting for next lead...</div>
          <div style={{ fontSize:12 }}>Customer information appears here when a call is assigned</div>
        </div>
      ) : (
        <>
          {/* Quick action bar */}
          <div className="qa-bar">
            <span style={{ fontSize:10, color:'var(--text2)', fontWeight:700, marginRight:4 }}>QUICK:</span>
            {['Info','History','Notes'].map(t => (
              <button key={t} onClick={() => setTab(t.toLowerCase())}
                style={{ padding:'3px 10px', borderRadius:3, cursor:'pointer', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', border:'none', background: tab === t.toLowerCase() ? 'var(--cyan)' : 'var(--bg-elevated)', color: tab === t.toLowerCase() ? '#000' : 'var(--text2)', transition:'all 0.15s' }}>
                {t}
              </button>
            ))}
          </div>

          <div className="tabs">
            {['info','history','notes'].map(t => (
              <div key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
                {t === 'info' ? '📋 Info' : t === 'history' ? `📞 History (${(lead.call_history||[]).length})` : '📝 Notes'}
              </div>
            ))}
          </div>

          <div style={{ flex:1, overflow:'auto' }}>
            {tab === 'info'    && <InfoTab lead={lead} fields={fields} set={set} campaignName={campaignName} callState={callState} customFields={customFields} />}
            {tab === 'history' && <HistoryTab lead={lead} />}
            {tab === 'notes'   && <NotesTab notes={notes} setNotes={setNotes} lead={lead} onDNC={handleDNC} />}
          </div>
        </>
      )}
    </div>
  );
}
