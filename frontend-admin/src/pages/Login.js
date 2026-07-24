import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import logo from '../logo.png';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(139,92,246,0.32)',
    color: '#f5f0ff',
  };
  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(1200px 600px at 10% -10%, #3b1d6e 0%, transparent 55%), radial-gradient(900px 500px at 110% 110%, #6d216b 0%, transparent 55%), #140f1f',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img src={logo} alt="MynxDialer" style={{
            width: 88, height: 88, objectFit: 'contain', margin: '0 auto 16px', display: 'block'
          }} />
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4, color: '#f5f0ff' }}>MynxDialer</h1>
          <p style={{ color: '#b9a8d9', fontSize: 14 }}>Admin Panel — Sign In</p>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{
          background: 'rgba(20,15,31,0.82)',
          border: '2px solid rgba(139,92,246,0.28)',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
        }}>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-group">
            <label className="form-label" style={{ color: '#b9a8d9' }}>Username</label>
            <input
              className="input" type="text" autoFocus autoComplete="username" style={inputStyle}
              value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin" required
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label" style={{ color: '#b9a8d9' }}>Password</label>
            <input
              className="input" type="password" autoComplete="current-password" style={inputStyle}
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" required
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: 11 }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#8b7caa' }}>
          Default: admin / admin123
        </p>
        <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, letterSpacing: '.4px', color: '#8b7caa', opacity: 0.8 }}>
          Powered by <strong>Automynx</strong>
        </p>
      </div>
    </div>
  );
}
