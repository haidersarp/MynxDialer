import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatWidget from './ChatWidget';
import logo from '../logo.png';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Per-call "Call started" toasts removed — the Dashboard Live Call Feed already
  // shows this, and on predictive campaigns the toasts flooded/overlapped the UI.
  const [notifications] = useState([]);

  const handleLogout = async () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top header */}
        <header style={{
          height: 'var(--header-height)',
          background: '#ffffff',
          borderBottom: '2px solid var(--bg-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 28px', flexShrink: 0,
          boxShadow: '0 2px 12px rgba(124,58,237,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16,185,129,0.6)' }} />
            <span className="gtext" style={{ fontWeight: 900, fontSize: 15, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              ◉ {user?.account_name || 'DIALER ADMIN'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {user?.full_name || user?.username}
              <span style={{ marginLeft: 6, padding: '2px 7px', borderRadius: 4, background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>
                {user?.role?.toUpperCase()}
              </span>
            </span>
            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </header>
        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          <Outlet />
        </main>
      </div>

      {/* Notification toasts */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999 }}>
        {notifications.map(n => (
          <div key={n.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderLeft: `3px solid ${n.type === 'info' ? 'var(--accent)' : n.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
            borderRadius: 'var(--radius)', padding: '10px 16px',
            boxShadow: 'var(--shadow)', fontSize: 13, color: 'var(--text-primary)',
            animation: 'slideIn 0.2s ease'
          }}>
            {n.msg}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: none; opacity: 1; } }
      `}</style>

      {/* Internal team chat (rides existing socket; no call impact) */}
      <ChatWidget user={user} />

      {/* Persistent brand watermark — stays on the dialer at all times. */}
      <img src={logo} alt="" aria-hidden="true" style={{
        position: 'fixed', bottom: 12, right: 14, width: 38, height: 38,
        objectFit: 'contain', opacity: 0.12, pointerEvents: 'none', zIndex: 5, userSelect: 'none'
      }} />
    </div>
  );
}