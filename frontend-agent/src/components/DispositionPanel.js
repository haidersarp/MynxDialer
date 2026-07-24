import React, { useState } from 'react';

export default function DispositionPanel({ dispositions, callState, onDisposition }) {
  const [notes, setNotes] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [selectedDisp, setSelectedDisp] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const canDisposition = callState && ['answered', 'ended', 'ringing'].includes(callState.status);

  const handleSelect = (disp) => {
    if (!canDisposition) return;
    setSelectedDisp(disp);
    if (!disp.is_callback) setCallbackAt('');
  };

  const handleSubmit = async () => {
    if (!selectedDisp) return;
    setSubmitting(true);
    try {
      await onDisposition(selectedDisp.id, notes, callbackAt || null);
      setSelectedDisp(null);
      setNotes('');
      setCallbackAt('');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)' }}>
        Disposition
      </div>

      {!canDisposition ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <div style={{ marginBottom: 6, opacity: 0.5 }}>🏷</div>
          Disposition available during/after call
        </div>
      ) : (
        <div style={{ padding: 10, overflow: 'auto' }}>
          {dispositions.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 10 }}>No dispositions configured</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {dispositions.map(d => (
                <button
                  key={d.id}
                  onClick={() => handleSelect(d)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 12px', borderRadius: 'var(--r)', cursor: 'pointer', transition: 'all 0.1s',
                    background: selectedDisp?.id === d.id ? d.color + '33' : 'var(--bg3)',
                    border: `1px solid ${selectedDisp?.id === d.id ? d.color : 'var(--border)'}`,
                    textAlign: 'left'
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: selectedDisp?.id === d.id ? 700 : 500, color: 'var(--text)' }}>
                    {d.label}
                  </span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {d.is_sale && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, background: 'rgba(63,185,80,0.2)', color: 'var(--green)', fontWeight: 700 }}>SALE</span>}
                    {d.is_dnc && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, background: 'rgba(248,81,73,0.2)', color: 'var(--red)', fontWeight: 700 }}>DNC</span>}
                    {d.is_callback && <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, background: 'rgba(210,153,34,0.2)', color: 'var(--yellow)', fontWeight: 700 }}>CB</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedDisp && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="label" style={{ marginBottom: 5 }}>Notes</div>
              <textarea className="textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes..." style={{ marginBottom: 8 }} />

              {selectedDisp.is_callback && (
                <div style={{ marginBottom: 8 }}>
                  <div className="label" style={{ marginBottom: 5 }}>Callback Date/Time</div>
                  <input type="datetime-local" className="input" value={callbackAt} onChange={e => setCallbackAt(e.target.value)} />
                </div>
              )}

              <button
                className="btn btn-primary"
                style={{ width: '100%', background: selectedDisp.color, color: '#000', borderColor: selectedDisp.color }}
                onClick={handleSubmit}
                disabled={submitting || (selectedDisp.is_callback && !callbackAt)}
              >
                {submitting ? 'Saving...' : `Submit: ${selectedDisp.label}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
