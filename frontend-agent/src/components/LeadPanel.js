import React from 'react';

function Field({ label, value, mono }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)', fontFamily: mono ? 'var(--mono)' : undefined }}>{value}</div>
    </div>
  );
}

export default function LeadPanel({ lead, callState }) {
  if (!lead) {
    return (
      <div className="card" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 48, opacity: 0.3 }}>👤</div>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>Waiting for next lead...</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Lead info will appear here when a call is assigned</div>
      </div>
    );
  }

  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
  const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
  const customFields = (() => {
    try { return typeof lead.custom_fields === 'string' ? JSON.parse(lead.custom_fields) : lead.custom_fields; }
    catch { return null; }
  })();

  return (
    <div className="card" style={{ height: '100%', padding: 20, overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{fullName || 'Unknown Lead'}</h2>
          <div style={{ fontSize: 20, fontFamily: 'var(--mono)', color: 'var(--accent)', letterSpacing: 2 }}>
            {lead.phone}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text2)', marginBottom: 4 }}>Attempts</div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--mono)', color: lead.attempts >= 3 ? 'var(--yellow)' : 'var(--text)' }}>
            {lead.attempts || 0}
          </div>
        </div>
      </div>

      {/* Contact info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', marginBottom: 16 }}>
        <Field label="Email" value={lead.email} />
        <Field label="Address" value={fullAddress} />
        {lead.last_disposition && (
          <Field label="Last Disposition" value={lead.last_disposition} />
        )}
      </div>

      {/* Custom fields */}
      {customFields && Object.keys(customFields).length > 0 && (
        <div style={{ marginBottom: 16, padding: 14, background: 'var(--bg2)', borderRadius: 'var(--r)', border: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 10 }}>
            Additional Info
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
            {Object.entries(customFields).map(([k, v]) => v && (
              <div key={k}>
                <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}: </span>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call history */}
      {lead.call_history && lead.call_history.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)', marginBottom: 10 }}>
            Call History
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lead.call_history.slice(0, 5).map(call => (
              <div key={call.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: 'var(--bg2)', borderRadius: 'var(--r)',
                border: '1px solid var(--border2)', fontSize: 12
              }}>
                <span style={{ color: 'var(--text2)' }}>{new Date(call.called_at).toLocaleDateString()}</span>
                <span>{call.agent_name || 'Unknown'}</span>
                {call.disposition_label ? (
                  <span style={{ padding: '2px 8px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', color: 'var(--text)' }}>
                    {call.disposition_label}
                  </span>
                ) : <span style={{ color: 'var(--muted)' }}>No disp.</span>}
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--text2)' }}>
                  {call.duration ? `${Math.floor(call.duration/60)}:${(call.duration%60).toString().padStart(2,'0')}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes area */}
      <div style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>Notes</div>
        <textarea className="textarea" rows={3} placeholder="Add notes about this call..." />
      </div>
    </div>
  );
}
