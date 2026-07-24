import React, { useEffect, useState } from 'react';

// Per-account "kill switch" overlay. Polls /api/auth/me; when the logged-in
// user's account is suspended, it blocks the whole screen.
//  - admin : shows the specific reason the super-admin picked + "CONTACT ADMIN"
//  - agent : shows a generic "contact your supervisor" message
const REASONS = {
  payment:   'A VoIP payment needs to be completed.',
  updating:  'The dialer is being updated.',
  technical: 'A technical issue is being resolved.',
};

export default function SuspensionGate({ role }) {
  const [reason, setReason] = useState(undefined); // undefined = active/unknown

  useEffect(() => {
    const key = role === 'agent' ? 'agent_token' : 'admin_token';
    let stopped = false;
    async function check() {
      const token = localStorage.getItem(key);
      if (!token) { if (!stopped) setReason(undefined); return; }
      try {
        const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) return;
        const d = await r.json();
        const u = (d && d.user) || d;
        if (stopped) return;
        setReason(u && u.account_status === 'suspended' ? (u.suspend_reason || 'technical') : undefined);
      } catch (_) { /* keep previous state on network blips */ }
    }
    check();
    const iv = setInterval(check, 20000);
    return () => { stopped = true; clearInterval(iv); };
  }, [role]);

  if (reason === undefined) return null;

  const isAgent = role === 'agent';
  const title = isAgent ? 'Internal Issue' : 'Account Temporarily Disabled';
  const message = isAgent ? 'Please contact your Supervisor.' : (REASONS[reason] || 'Your account is temporarily disabled.');

  return (
    <div style={{ position:'fixed', inset:0, zIndex:99999, background:'rgba(10,12,25,0.97)', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)', WebkitBackdropFilter:'blur(4px)' }}>
      <div style={{ textAlign:'center', maxWidth:460, padding:'36px 30px', background:'#1a1c33', border:'1px solid #2c2f57', borderRadius:16, color:'#e8e9f5', fontFamily:'Segoe UI, system-ui, sans-serif', boxShadow:'0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize:54, marginBottom:14 }}>{isAgent ? '🔧' : '⛔'}</div>
        <div style={{ fontSize:22, fontWeight:900, marginBottom:12 }}>{title}</div>
        <div style={{ fontSize:16, color:'#c9cbe8', lineHeight:1.55 }}>{message}</div>
        {!isAgent && <div style={{ marginTop:18, fontSize:13, fontWeight:800, letterSpacing:1.5, color:'#a78bfa' }}>CONTACT ADMIN</div>}
      </div>
    </div>
  );
}
