import React, { useState, useRef, useEffect } from 'react';

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioPlayer({ src, callId, compact }) {
  const audioRef = useRef(null);
  const [playing, setPlaying]   = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent]   = useState(0);
  const [volume, setVolume]     = useState(1);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [blobUrl, setBlobUrl]   = useState(null);
  const wantPlay = useRef(false);

  // A plain <audio src> can't send the Bearer token, and the recording endpoint
  // requires it in the Authorization header (query ?token= is ignored server-side).
  // So we lazily fetch the recording WITH the auth header as a blob the first time
  // the user hits Play, then play that object URL. Lazy = list rows don't all
  // download at once.
  const directSrc = src || null;
  const audioSrc  = directSrc || blobUrl;
  const hasRecording = !!(directSrc || callId);

  // Revoke the object URL when it changes / on unmount.
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  // Once the blob is ready and the user asked to play, start playback.
  useEffect(() => {
    if (audioSrc && wantPlay.current && audioRef.current) {
      wantPlay.current = false;
      audioRef.current.play().then(() => setPlaying(true)).catch(e => setError(e.message));
    }
  }, [audioSrc]);

  const fetchRecording = async () => {
    if (audioSrc || !callId) return;
    setLoading(true); setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const r = await fetch(`/api/calls/${callId}/recording`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!r.ok) throw new Error('not found');
      setBlobUrl(URL.createObjectURL(await r.blob()));
    } catch (_) {
      setError('Recording unavailable');
    } finally {
      setLoading(false);
    }
  };

  if (!hasRecording) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '4px 8px' : '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius)', border: '1px solid var(--border-dim)', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>🎙</span> No recording available
      </div>
    );
  }

  const togglePlay = () => {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    if (!audioSrc) { wantPlay.current = true; fetchRecording(); return; }
    audioRef.current?.play().then(() => setPlaying(true)).catch(e => setError(e.message));
  };

  const handleSeek = e => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = pct * duration;
  };

  const handleDownload = async (e) => {
    if (e) e.preventDefault();
    let url = audioSrc;
    if (!url) {
      if (!callId) return;
      setLoading(true); setError(null);
      try {
        const token = localStorage.getItem('admin_token');
        const r = await fetch(`/api/calls/${callId}/recording`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!r.ok) throw new Error('not found');
        url = URL.createObjectURL(await r.blob());
        setBlobUrl(url);
      } catch (_) {
        setError('Recording unavailable'); setLoading(false); return;
      }
      setLoading(false);
    }
    // Trigger the download programmatically (href on the <a> may not be set yet).
    const a = document.createElement('a');
    a.href = url;
    a.download = `recording-${callId}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const progress = duration > 0 ? (current / duration) * 100 : 0;

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <audio ref={audioRef} src={audioSrc || undefined} preload="none"
          onLoadedMetadata={e => { setDuration(e.target.duration); setLoading(false); }}
          onTimeUpdate={e => setCurrent(e.target.currentTime)}
          onEnded={() => setPlaying(false)}
          onError={() => { if (audioSrc) { setError('Failed to load'); setLoading(false); } }} />

        <button onClick={togglePlay} disabled={!!error} style={{
          width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: error ? 'not-allowed' : 'pointer',
          background: error ? 'rgba(255,82,82,0.2)' : playing ? 'var(--danger)' : 'linear-gradient(135deg,var(--accent),var(--info))',
          color: error ? 'var(--danger)' : '#000', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, boxShadow: playing ? '0 0 10px rgba(255,82,82,0.4)' : '0 0 10px rgba(0,229,255,0.3)'
        }}>
          {loading ? '⏳' : error ? '✕' : playing ? '⏸' : '▶'}
        </button>

        <div onClick={handleSeek} style={{ flex: 1, height: 4, background: 'var(--bg-input)', borderRadius: 2, cursor: 'pointer', overflow: 'hidden', minWidth: 60 }}>
          <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,var(--accent),var(--info))', borderRadius: 2, transition: 'width 0.1s' }} />
        </div>

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          {formatTime(current)}/{formatTime(duration)}
        </span>
      </div>
    );
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--bg-tertiary))', border: '1px solid var(--border-glow)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
      <audio ref={audioRef} src={audioSrc || undefined} preload="none"
        onLoadedMetadata={e => { setDuration(e.target.duration); setLoading(false); }}
        onTimeUpdate={e => setCurrent(e.target.currentTime)}
        onEnded={() => setPlaying(false)}
        onError={() => { if (audioSrc) { setError('Recording file not found'); setLoading(false); } }} />

      {error ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontSize: 12 }}>
          <span>⚠</span> {error}
        </div>
      ) : (
        <>
          {/* Waveform progress bar */}
          <div onClick={handleSeek} style={{ height: 36, background: 'var(--bg-input)', borderRadius: 'var(--radius)', cursor: 'pointer', overflow: 'hidden', position: 'relative', marginBottom: 10, border: '1px solid var(--border-dim)' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, rgba(0,229,255,0.3), rgba(41,121,255,0.3))', transition: 'width 0.1s' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
              {Array.from({ length: 40 }, (_, i) => (
                <div key={i} style={{
                  width: 2, borderRadius: 1,
                  height: `${20 + Math.sin(i * 0.8) * 14 + Math.sin(i * 1.5) * 8}%`,
                  background: i / 40 < progress / 100 ? 'var(--accent)' : 'var(--border)',
                  transition: 'background 0.1s'
                }} />
              ))}
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={togglePlay} style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: playing ? 'linear-gradient(135deg,var(--danger),#b71c1c)' : 'linear-gradient(135deg,var(--accent),var(--info))',
              color: playing ? '#fff' : '#000', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: playing ? '0 0 16px rgba(255,82,82,0.4)' : '0 0 16px rgba(0,229,255,0.3)',
              transition: 'all 0.15s', flexShrink: 0
            }}>
              {loading ? '⏳' : playing ? '⏸' : '▶'}
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{formatTime(current)}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{formatTime(duration)}</span>
              </div>
              <input type="range" min={0} max={duration || 100} value={current} step={0.1}
                onChange={e => { if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }}
                style={{ width: '100%', accentColor: 'var(--accent)', height: 4, cursor: 'pointer' }} />
            </div>

            {/* Volume */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>🔊</span>
              <input type="range" min={0} max={1} step={0.05} value={volume}
                onChange={e => { const v = parseFloat(e.target.value); setVolume(v); if (audioRef.current) audioRef.current.volume = v; }}
                style={{ width: 60, accentColor: 'var(--accent)', cursor: 'pointer' }} />
            </div>

            {/* Download */}
            <button onClick={handleDownload}
              style={{ width: 30, height: 30, borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 13, background: 'none', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              title="Download recording">
              ↓
            </button>
          </div>
        </>
      )}
    </div>
  );
}