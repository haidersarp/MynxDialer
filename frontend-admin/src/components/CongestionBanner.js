import React, { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';

// Fixed red banner shown whenever the backend reports carrier (trunk) congestion —
// i.e. the SIP provider is rejecting outbound calls (503). Driven by the
// 'trunk:congestion' socket event; auto-hides when it clears.
export default function CongestionBanner() {
  const [cong, setCong] = useState(null); // { count } when active, else null

  useEffect(() => {
    const s = getSocket();
    const handler = (data) => {
      if (data && data.active) setCong({ count: data.count || 0 });
      else setCong(null);
    };
    s.on('trunk:congestion', handler);
    return () => s.off('trunk:congestion', handler);
  }, []);

  // Safety auto-clear if the "cleared" event is ever missed.
  useEffect(() => {
    if (!cong) return;
    const t = setTimeout(() => setCong(null), 45000);
    return () => clearTimeout(t);
  }, [cong]);

  if (!cong) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: 'linear-gradient(90deg,#b71c1c,#ff5252)', color: '#fff',
      padding: '10px 18px', textAlign: 'center', fontSize: 13.5, fontWeight: 700,
      boxShadow: '0 2px 14px rgba(0,0,0,0.35)', letterSpacing: '0.01em'
    }}>
      ⚠ Carrier congestion — the trunk rejected {cong.count} call{cong.count === 1 ? '' : 's'} in the last minute.
      Calls may be failing to connect. Speak to your IT TEAM to verify concurrent-channel limit / balance.
    </div>
  );
}
