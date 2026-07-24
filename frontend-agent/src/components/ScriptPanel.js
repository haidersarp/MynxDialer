import React, { useState } from 'react';

export default function ScriptPanel({ campaign }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!campaign?.script) return null;

  return (
    <div className="card" style={{ padding: 0 }}>
      <div
        style={{ padding: '10px 14px', borderBottom: collapsed ? 'none' : '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text2)' }}>
          📄 Script
        </span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{collapsed ? '▼ Show' : '▲ Hide'}</span>
      </div>
      {!collapsed && (
        <div style={{
          padding: '12px 14px', fontSize: 13, lineHeight: 1.7,
          color: 'var(--text)', whiteSpace: 'pre-wrap', maxHeight: 200,
          overflow: 'auto', borderRadius: '0 0 var(--r2) var(--r2)'
        }}>
          {campaign.script}
        </div>
      )}
    </div>
  );
}
