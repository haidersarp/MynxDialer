import React, { useState } from 'react';

export default function TalkTrack({ campaign, width = 280 }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="panel" style={{ width, flexShrink: 0 }}>
      <div className="panel-hdr panel-hdr-green" style={{ cursor:'pointer' }} onClick={() => setCollapsed(!collapsed)}>
        <span>📄 Talk Track</span>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {campaign?.name && <span style={{ fontSize:10, color:'rgba(255,255,255,0.6)', fontWeight:500 }}>{campaign.name}</span>}
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)' }}>{collapsed ? '▼' : '↺'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="panel-body" style={{ padding:'14px 16px' }}>
          {!campaign?.script ? (
            <div style={{ color:'var(--text2)', fontSize:13, textAlign:'center', padding:'40px 0' }}>
              <div style={{ fontSize:36, marginBottom:10, opacity:0.3 }}>📄</div>
              No script configured for this campaign.
            </div>
          ) : (
            <div style={{ fontSize:13, lineHeight:1.8, color:'var(--text)' }}>
              {campaign.script.split('\n').map((line, i) => {
                if (line.startsWith('Agent:') || line.startsWith('AGENT:'))
                  return <div key={i} style={{ marginBottom:10, padding:'8px 12px', background:'rgba(124,58,237,0.08)', borderLeft:'3px solid var(--purple)', borderRadius:'0 8px 8px 0', fontSize:13 }}>
                    <div style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'var(--purple)', marginBottom:3 }}>Agent</div>
                    {line.replace(/^(Agent|AGENT):/, '').trim()}
                  </div>;
                if (line.startsWith('Customer:') || line.startsWith('CUSTOMER:'))
                  return <div key={i} style={{ marginBottom:10, padding:'8px 12px', background:'rgba(16,185,129,0.08)', borderLeft:'3px solid var(--green)', borderRadius:'0 8px 8px 0', fontSize:13 }}>
                    <div style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', color:'var(--green)', marginBottom:3 }}>Customer</div>
                    {line.replace(/^(Customer|CUSTOMER):/, '').trim()}
                  </div>;
                if (!line.trim()) return <div key={i} style={{ height:6 }} />;
                return <div key={i} style={{ marginBottom:4 }}>{line}</div>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}