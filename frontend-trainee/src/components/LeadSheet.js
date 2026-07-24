import React from 'react';

// Option 3: the lead the shadowed agent is currently working, mirroring what is
// on the agent's own screen — except the phone number, which arrives already
// masked from the API, and email/address, which are never sent to a trainee.
export default function LeadSheet({ context, agent }) {
  if (!agent) {
    return <div className="tr-panel tr-panel-pad">
      <p className="tr-empty">Pick an agent on the left to start shadowing.</p>
    </div>;
  }

  if (!context) {
    return <div className="tr-panel tr-panel-pad">
      <p className="tr-empty">Loading {agent.full_name || agent.username}…</p>
    </div>;
  }

  if (!context.on_call || !context.lead) {
    return <div className="tr-panel tr-panel-pad">
      <div className="tr-waiting">
        <div className="tr-waiting-pulse" />
        <p><strong>{agent.full_name || agent.username}</strong> is not on a call.</p>
        <p className="tr-muted">The lead will appear here the moment they connect.</p>
      </div>
    </div>;
  }

  const l = context.lead;
  let custom = null;
  try {
    custom = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields) : l.custom_fields;
  } catch (_) { custom = null; }

  return (
    <div className="tr-panel tr-panel-pad">
      <div className="tr-lead-head">
        <h2>{[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Unnamed lead'}</h2>
        <span className="tr-live-tag">● LIVE</span>
      </div>

      <div className="tr-fields">
        <Field label="Phone" value={l.phone_masked} hint="masked for trainees" />
        <Field label="City"  value={l.city} />
        <Field label="State" value={l.state} />
        <Field label="Post code" value={l.zip} />
        <Field label="Status" value={l.status} />
        <Field label="Attempts" value={l.attempts} />
        <Field label="Last disposition" value={l.last_disposition} />
        <Field label="Campaign" value={context.campaign_name} />
      </div>

      {custom && typeof custom === 'object' && Object.keys(custom).length > 0 && (
        <>
          <div className="tr-group-label">Additional details</div>
          <div className="tr-fields">
            {Object.entries(custom).map(([k, v]) => (
              <Field key={k} label={k} value={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, hint }) {
  return (
    <div className="tr-field">
      <div className="tr-field-label">{label}{hint && <em> · {hint}</em>}</div>
      <div className="tr-field-value">{value === null || value === undefined || value === '' ? '—' : value}</div>
    </div>
  );
}
