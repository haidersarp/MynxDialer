import React from 'react';

// Option 4: the same campaign script the agent has on their dashboard, pulled
// from campaigns.script so it stays in step with whatever admin has published.
export default function ScriptPanel({ context, agent }) {
  if (!agent) {
    return <div className="tr-panel tr-panel-pad">
      <p className="tr-empty">Pick an agent on the left to see their script.</p>
    </div>;
  }

  const script = context?.script;

  return (
    <div className="tr-panel tr-panel-pad">
      <div className="tr-lead-head">
        <h2>Script</h2>
        {context?.campaign_name && <span className="tr-chip">{context.campaign_name}</span>}
      </div>
      {script
        ? <div className="tr-script">{script}</div>
        : <p className="tr-empty">
            No script is set for this campaign{context?.campaign_name ? '' : ' yet'}.
          </p>}
    </div>
  );
}
