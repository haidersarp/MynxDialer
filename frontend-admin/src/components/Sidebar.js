import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import logo from '../logo.png';
import { useAuth } from '../context/AuthContext';

const nav = [
  { path:'/',             label:'Dashboard',    icon:'📊', desc:'Overview',         color:'#7c3aed', bg:'rgba(124,58,237,0.15)' },
  { path:'/monitor',      label:'Live Monitor', icon:'◉',  desc:'Real-time',        color:'#ef4444', bg:'rgba(239,68,68,0.12)',  badge:'LIVE' },
  { path:'/campaigns',    label:'Campaigns',    icon:'🎯', desc:'Manage',           color:'#3b82f6', bg:'rgba(59,130,246,0.12)' },
  { path:'/leads',        label:'Lead Search',  icon:'🔍', desc:'Find specific leads',color:'#8b5cf6', bg:'rgba(139,92,246,0.12)' },
  { path:'/lead-lists',   label:'Lead Lists',   icon:'📋', desc:'Upload & manage data',color:'#06b6d4', bg:'rgba(6,182,212,0.12)' },
  { path:'/lead-recycle', label:'Lead Recycle', icon:'♻',  desc:'Recycle & redial',  color:'#10b981', bg:'rgba(16,185,129,0.12)' },
  { path:'/agents',       label:'Agents',       icon:'🎧', desc:'Accounts',         color:'#10b981', bg:'rgba(16,185,129,0.12)' },
  { path:'/cid',          label:'CID Groups',   icon:'📞', desc:'Caller IDs',       color:'#f59e0b', bg:'rgba(245,158,11,0.12)' },
  { path:'/dispositions', label:'Dispositions', icon:'🏷',  desc:'Outcomes',         color:'#ec4899', bg:'rgba(236,72,153,0.12)' },
  { path:'/appointments', label:'Appointments', icon:'🗓', desc:'Booked leads',     color:'#06b6d4', bg:'rgba(6,182,212,0.12)'  },
  { path:'/reports',      label:'Reports',      icon:'📈', desc:'Analytics',        color:'#6366f1', bg:'rgba(99,102,241,0.12)' },
  { path:'/dnc',          label:'DNC List',     icon:'🚫', desc:'Do not call',      color:'#ef4444', bg:'rgba(239,68,68,0.1)'   },
  { path:'/settings',     label:'Settings',     icon:'⚙',  desc:'Config',           color:'#64748b', bg:'rgba(100,116,139,0.1)' },
];

export default function Sidebar() {
  const { user } = useAuth();
  const loc = useLocation();

  return (
    <aside style={{
      width: 'var(--sidebar-width)',
      background: '#1e1248',
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto',
      boxShadow: '4px 0 24px rgba(30,18,72,0.15)',
    }}>
      {/* Logo */}
      <div style={{
        height: 'var(--header-height)',
        display: 'flex', alignItems: 'center',
        padding: '0 20px', gap: 12, flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <img src={logo} alt="Automynx" style={{
          width: 40, height: 40, objectFit: 'contain',
        }} />
        <div>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#fff', letterSpacing: '-0.5px', lineHeight: 1 }}>
            {user?.account_name || 'MynxDialer'}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(167,139,250,0.7)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
            Admin Panel
          </div>
        </div>
      </div>

      {/* Nav label */}
      <div style={{ padding: '16px 20px 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.25)' }}>
        Navigation
      </div>

      {/* Nav items */}
      <nav style={{ padding: '0 10px', flex: 1 }}>
        {nav.map(item => {
          const active = item.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(item.path);
          return (
            <NavLink key={item.path} to={item.path} style={{ textDecoration: 'none', display: 'block', marginBottom: 3 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '9px 12px', borderRadius: 12,
                cursor: 'pointer', transition: 'all 0.2s',
                background: active ? item.bg : 'transparent',
                boxShadow: active ? `0 4px 14px ${item.color}22` : 'none',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: active ? item.color : 'rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, transition: 'all 0.2s',
                  boxShadow: active ? `0 4px 10px ${item.color}55` : 'none',
                }}>
                  {item.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: active ? 800 : 600, lineHeight: 1.2, color: active ? '#fff' : 'rgba(255,255,255,0.65)' }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{item.desc}</div>
                </div>
                {item.badge && (
                  <span style={{
                    fontSize: 9, padding: '2px 7px', borderRadius: 100,
                    background: '#ef4444', color: '#fff',
                    fontWeight: 800, letterSpacing: '0.05em',
                    boxShadow: '0 0 10px rgba(239,68,68,0.5)',
                    animation: 'pulse-badge 2s infinite',
                  }}>
                    {item.badge}
                  </span>
                )}
              </div>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 6, fontWeight: 600 }}>VERSION 1.0.0</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16,185,129,0.7)' }} />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>All systems operational</span>
        </div>
      </div>

      <style>{`
        @keyframes pulse-badge{0%,100%{box-shadow:0 0 6px rgba(239,68,68,0.5)}50%{box-shadow:0 0 14px rgba(239,68,68,0.8)}}
        @keyframes pulse-green{0%,100%{box-shadow:0 0 0 3px rgba(16,185,129,0.25)}50%{box-shadow:0 0 0 8px rgba(16,185,129,0.08)}}
        @keyframes pulse-coral{0%,100%{box-shadow:0 0 0 3px rgba(255,95,109,0.25)}50%{box-shadow:0 0 0 8px rgba(255,95,109,0.08)}}
      `}</style>
    </aside>
  );
}