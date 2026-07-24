import React from 'react';

// Option 1: pick an agent to shadow. Trainees can hop between agents freely —
// switching just re-points the listen leg; it never touches either agent's call.
export default function AgentList({ agents, listeningTo, onListen, onStop, disabled }) {
  const onCall = agents.filter(a => a.on_call);
  const idle   = agents.filter(a => !a.on_call);

  return (
    <div className="tr-panel">
      <div className="tr-panel-head">
        <h3>Agents</h3>
        <span className="tr-count">{agents.length}</span>
      </div>

      {agents.length === 0 && (
        <p className="tr-empty">No agents are logged in right now.</p>
      )}

      {onCall.length > 0 && <div className="tr-group-label">On a call</div>}
      {onCall.map(a => (
        <AgentRow key={a.id} agent={a} listeningTo={listeningTo}
                  onListen={onListen} onStop={onStop} disabled={disabled} />
      ))}

      {idle.length > 0 && <div className="tr-group-label">Available</div>}
      {idle.map(a => (
        <AgentRow key={a.id} agent={a} listeningTo={listeningTo}
                  onListen={onListen} onStop={onStop} disabled={disabled} />
      ))}
    </div>
  );
}

function AgentRow({ agent, listeningTo, onListen, onStop, disabled }) {
  const active = listeningTo && listeningTo.id === agent.id;
  return (
    <div className={`tr-agent ${active ? 'is-active' : ''}`}>
      <div className="tr-agent-main">
        <div className="tr-agent-name">
          {agent.full_name || agent.username}
          {agent.on_call && <span className="tr-dot-live" title="On a call" />}
        </div>
        <div className="tr-agent-meta">
          ext {agent.extension}
          {agent.campaign_name ? ` · ${agent.campaign_name}` : ''}
          {agent.on_call ? ' · on call' : ` · ${agent.status}`}
        </div>
      </div>
      {active ? (
        <button className="tr-btn tr-btn-stop" onClick={onStop}>Stop</button>
      ) : (
        <button className="tr-btn tr-btn-listen" disabled={disabled}
                onClick={() => onListen(agent)}>Listen</button>
      )}
    </div>
  );
}
