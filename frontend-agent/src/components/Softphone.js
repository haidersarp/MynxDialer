import React, { useState, useEffect, useRef } from 'react';
import { makeCall } from '../services/sipClient';

function useCallTimer(answeredAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!answeredAt) { setElapsed(0); return; }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(answeredAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [answeredAt]);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const DIALPAD = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', '']
];

export default function Softphone({ sipStatus, callState, isMuted, isOnHold, incomingSession, sipConfig, onAnswer, onHangup, onMute, onHold, onDTMF, onTransfer }) {
  const [dialInput, setDialInput] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const callTimer = useCallTimer(callState?.answered_at);

  const hasCall = callState && ['ringing', 'answered'].includes(callState.status);
  const isAnswered = callState?.status === 'answered';

  const handleDialpadKey = (digit) => {
    if (isAnswered) { onDTMF(digit); return; }
    setDialInput(d => d + digit);
  };

  const handleCall = () => {
    if (!dialInput.trim()) return;
    makeCall(dialInput.trim(), sipConfig);
  };

  const handleTransfer = () => {
    if (!transferTarget.trim()) return;
    onTransfer(transferTarget.trim());
    setShowTransfer(false);
    setTransferTarget('');
  };

  const statusColor = sipStatus === 'registered' ? 'var(--green)' : sipStatus === 'registering' ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Softphone
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 11, color: statusColor, fontWeight: 600, textTransform: 'capitalize' }}>{sipStatus}</span>
        </div>
      </div>

      {/* Call status display */}
      <div style={{
        padding: '20px 16px', textAlign: 'center', minHeight: 100,
        background: hasCall ? (isAnswered ? 'rgba(248,81,73,0.08)' : 'rgba(210,153,34,0.08)') : 'transparent',
        borderBottom: '1px solid var(--border)'
      }}>
        {callState?.incoming && !isAnswered ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ● INCOMING CALL
            </div>
            <div style={{ fontSize: 22, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', letterSpacing: 2 }}>
              {callState.caller_id}
            </div>
            {callState.caller_name && callState.caller_name !== callState.caller_id && (
              <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{callState.caller_name}</div>
            )}
          </div>
        ) : isAnswered ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ● ON CALL
            </div>
            <div style={{ fontSize: 32, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', letterSpacing: 2 }}>
              {callTimer}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{callState?.caller_id}</div>
          </div>
        ) : callState?.status === 'ringing' ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--yellow)', fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ◌ RINGING
            </div>
            <div style={{ fontSize: 20, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{callState?.caller_id}</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 30, marginBottom: 4, opacity: 0.4 }}>📞</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No active call</div>
          </div>
        )}
      </div>

      {/* Dial input */}
      {!hasCall && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input" style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 16, textAlign: 'center', letterSpacing: 3 }}
              value={dialInput} onChange={e => setDialInput(e.target.value.replace(/[^0-9*#+]/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleCall()}
              placeholder="Dial number..."
            />
            {dialInput && (
              <button className="btn btn-sm btn-secondary" onClick={() => setDialInput(d => d.slice(0, -1))}>⌫</button>
            )}
          </div>
        </div>
      )}

      {/* Dialpad */}
      <div style={{ padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {DIALPAD.map(([digit, sub]) => (
            <button
              key={digit}
              onClick={() => handleDialpadKey(digit)}
              style={{
                padding: '10px 4px', background: 'var(--bg3)', border: '1px solid var(--border)',
                borderRadius: 'var(--r)', cursor: 'pointer', transition: 'background 0.1s',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1
              }}
              onMouseDown={e => e.currentTarget.style.background = 'var(--border)'}
              onMouseUp={e => e.currentTarget.style.background = 'var(--bg3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg3)'}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{digit}</span>
              {sub && <span style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '0.06em' }}>{sub}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Call controls */}
      <div style={{ padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Answer / Hangup row */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {callState?.incoming && !isAnswered && (
            <button className="btn btn-circle lg btn-success" onClick={onAnswer} title="Answer" style={{ fontSize: 22 }}>📞</button>
          )}
          {!hasCall && dialInput && (
            <button className="btn btn-circle lg btn-success" onClick={handleCall} title="Call" style={{ fontSize: 22 }}>📞</button>
          )}
          {hasCall && (
            <button className="btn btn-circle lg btn-danger" onClick={onHangup} title="Hang Up" style={{ fontSize: 20 }}>✕</button>
          )}
        </div>

        {/* In-call controls */}
        {isAnswered && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button
              className={`btn btn-sm ${isMuted ? 'btn-danger' : 'btn-secondary'}`}
              onClick={onMute} title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇 Unmute' : '🎙 Mute'}
            </button>
            <button
              className={`btn btn-sm ${isOnHold ? 'btn-primary' : 'btn-secondary'}`}
              onClick={onHold} title={isOnHold ? 'Unhold' : 'Hold'}
            >
              {isOnHold ? '▶ Unhold' : '⏸ Hold'}
            </button>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => setShowTransfer(!showTransfer)} title="Transfer"
            >
              ⇄
            </button>
          </div>
        )}

        {showTransfer && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
              placeholder="Extension or number" value={transferTarget}
              onChange={e => setTransferTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTransfer()} />
            <button className="btn btn-sm btn-primary" onClick={handleTransfer}>Transfer</button>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowTransfer(false)}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}
