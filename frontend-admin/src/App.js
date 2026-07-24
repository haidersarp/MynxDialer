import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LiveMonitor from './pages/LiveMonitor';
import Campaigns from './pages/Campaigns';
import Leads from './pages/Leads';
import Agents from './pages/Agents';
import CIDGroups from './pages/CIDGroups';
import Dispositions from './pages/Dispositions';
import Reports from './pages/Reports';
import DNCList from './pages/DNCList';
import Appointments from './pages/Appointments';
import LeadLists    from './pages/LeadLists';
import LeadRecycle  from './pages/LeadRecycle';
import Settings from './pages/Settings';
import CongestionBanner from './components/CongestionBanner';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#8b949e' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

import SuspensionGate from './components/SuspensionGate';

function AppRoutes() {
  const { user } = useAuth();
  return (
    <>
    {user && <CongestionBanner />}
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="monitor" element={<LiveMonitor />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="leads" element={<Leads />} />
        <Route path="agents" element={<Agents />} />
        <Route path="cid" element={<CIDGroups />} />
        <Route path="dispositions" element={<Dispositions />} />
        <Route path="reports" element={<Reports />} />
        <Route path="dnc" element={<DNCList />} />
        <Route path="lead-lists"   element={<LeadLists />} />
        <Route path="lead-recycle" element={<LeadRecycle />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SuspensionGate role="admin" />
      <AppRoutes />
    </AuthProvider>
  );
}
