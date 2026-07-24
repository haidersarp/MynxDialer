import React, { useState, useEffect } from 'react';

function TickerItem({ item }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(item.startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [item.startedAt]);

  const statusColors = { dialing: 'dialing', answered: 'answered', transfer: 'transfer', ringing: 'ringing' };
  const cls = statusColors[item.status] || 'dialing';

  return (
    <div className="ticker-item">
      <span className={`ticker-dot ${cls}`} />
      <span className="ticker-phone">{item.phone}</span>
      <span className="ticker-status">{item.status?.toUpperCase()}</span>
      <span className="ticker-time">{elapsed}s</span>
    </div>
  );
}

export default function DialingTicker({ liveDialing, totalDialing }) {
  if (!liveDialing.length) {
    return (
      <div className="ticker-wrap" style={{ color: 'var(--muted)', fontSize: 11, fontStyle: 'italic' }}>
        <span style={{ marginRight: 12, fontSize: 11, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.06em' }}>
          ◉ LIVE DIALING {totalDialing > 0 ? totalDialing : 0}
        </span>
        No active dials
      </div>
    );
  }

  return (
    <div className="ticker-wrap">
      <span style={{ marginRight: 8, fontSize: 11, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.06em', flexShrink: 0 }}>
        ◉ LIVE {liveDialing.length}
      </span>
      {liveDialing.map(item => (
        <TickerItem key={item.id || item.phone} item={item} />
      ))}
    </div>
  );
}
