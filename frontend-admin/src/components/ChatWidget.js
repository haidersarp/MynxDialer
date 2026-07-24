import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { getSocket } from '../services/socket';

// Internal team chat (admin) — Announce (broadcast), per-campaign group chats
// (pick via dropdown), and 1:1 DMs. Admin can flag a message "Priority" so it
// pops up on the recipient agents' screens. Image/doc attachments supported.
const TOKEN_KEY = 'admin_token';
const USER_KEY = 'admin_user';

const ACCENT = '#22d3ee';
const ACCENT2 = '#7c3aed';
const PANEL_BG = '#0f1622';
const CARD_BG = '#161f2e';
const BORDER = '#243449';
const TEXT = '#e6edf6';
const TEXT2 = '#8aa0b8';

export default function ChatWidget({ user: userProp }) {
  const user = userProp || (() => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (_) { return null; } })();
  const myId = user?.id;

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('broadcast');       // broadcast | campaign | dm
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [dmUser, setDmUser] = useState(null);
  const [campList, setCampList] = useState([]);
  const [campId, setCampId] = useState('');           // selected campaign for the Campaign tab
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('chat_sound') !== '0');
  const [priority, setPriority] = useState(false);    // admin: send as priority popup
  const [shake, setShake] = useState(false);
  const [pendingAtt, setPendingAtt] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const audioCtxRef = useRef(null);
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  const token = () => localStorage.getItem(TOKEN_KEY);
  const isAuthed = !!token() && !!myId;
  const scrollDown = () => { setTimeout(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, 40); };

  const beep = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const tone = (freq, t0, dur, peak) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + t0);
        g.gain.exponentialRampToValueAtTime(peak, now + t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(now + t0); o.stop(now + t0 + dur + 0.03);
      };
      tone(784, 0, 0.18, 0.32);
      tone(1047, 0.12, 0.24, 0.32);
    } catch (_) {}
  }, []);

  const toggleSound = () => setSoundOn(v => { const nv = !v; localStorage.setItem('chat_sound', nv ? '1' : '0'); return nv; });

  const belongsToView = useCallback((m) => {
    if (tab === 'broadcast') return m.channel === 'broadcast';
    if (tab === 'campaign') return m.channel === 'campaign' && String(m.campaign_id) === String(campId);
    if (tab === 'dm' && dmUser) return m.channel === 'dm' && (
      (m.sender_id === myId && m.recipient_id === dmUser.id) ||
      (m.sender_id === dmUser.id && m.recipient_id === myId)
    );
    return false;
  }, [tab, dmUser, myId, campId]);

  useEffect(() => {
    if (!isAuthed) return;
    const s = getSocket();
    const onMsg = (m) => {
      setMessages(prev => (belongsToView(m) ? [...prev, m] : prev));
      if (belongsToView(m)) scrollDown();
      if (m.sender_id !== myId) {
        if (soundOnRef.current) beep();
        if (!open || !belongsToView(m)) {
          setUnread(u => u + 1);
          setShake(true);
          setTimeout(() => setShake(false), 600);
        }
      }
    };
    s.on('chat:message', onMsg);
    return () => s.off('chat:message', onMsg);
  }, [isAuthed, belongsToView, open, myId, beep]);

  const loadHistory = useCallback(async () => {
    try {
      const params = { channel: tab };
      if (tab === 'dm') { if (!dmUser) { setMessages([]); return; } params.with = dmUser.id; }
      if (tab === 'campaign') { if (!campId) { setMessages([]); return; } params.campaign_id = campId; }
      const data = await api.get('/chat/history', { params });
      setMessages(Array.isArray(data) ? data : []);
      scrollDown();
    } catch (_) { setMessages([]); }
  }, [tab, dmUser, campId]);

  const loadMeta = useCallback(async () => {
    try { const d = await api.get('/chat/users'); setUsers(Array.isArray(d) ? d : []); } catch (_) {}
    try { const d = await api.get('/chat/campaigns'); setCampList(Array.isArray(d) ? d : []); } catch (_) {}
  }, []);

  useEffect(() => { if (open && isAuthed) loadHistory(); }, [open, tab, dmUser, campId, isAuthed, loadHistory]);
  useEffect(() => { if (open && isAuthed) { loadMeta(); setUnread(0); } }, [open, isAuthed, loadMeta]);

  const uploadFile = async (file) => {
    if (!file) return;
    setAttaching(true);
    try {
      const form = new FormData(); form.append('file', file);
      const r = await api.post('/chat/upload', form);
      if (r && r.url) setPendingAtt(r);
    } catch (e) { alert(e.error || 'Upload failed (images & PDF/Word/Excel up to 10MB)'); }
    finally { setAttaching(false); }
  };

  const onPaste = (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) {
        const file = it.getAsFile();
        if (file) { e.preventDefault(); uploadFile(file); return; }
      }
    }
  };

  const send = () => {
    const body = text.trim();
    if (!body && !pendingAtt) return;
    if (tab === 'dm' && !dmUser) return;
    if (tab === 'campaign' && !campId) return;
    getSocket().emit('chat:send', {
      channel: tab,
      recipient_id: tab === 'dm' ? dmUser.id : undefined,
      campaign_id: tab === 'campaign' ? campId : undefined,
      body,
      priority: priority ? 1 : 0,
      attachment: pendingAtt || undefined
    });
    setText(''); setPendingAtt(null);
  };

  const fmtTime = (ts) => { try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

  if (!isAuthed) return null;

  const tabs = [
    { key: 'broadcast', label: 'Announce' },
    { key: 'campaign', label: 'Campaign' },
    { key: 'dm', label: 'Direct' }
  ];
  const canType = tab === 'broadcast' || (tab === 'campaign' && !!campId) || (tab === 'dm' && !!dmUser);

  return (
    <>
      <style>{`@keyframes chatShake{0%,100%{transform:translateX(0) rotate(0)}15%{transform:translateX(-3px) rotate(-7deg)}30%{transform:translateX(3px) rotate(7deg)}45%{transform:translateX(-3px) rotate(-5deg)}60%{transform:translateX(3px) rotate(5deg)}75%{transform:translateX(-2px) rotate(-2deg)}}@keyframes chatBadgePop{0%{transform:scale(0.4)}60%{transform:scale(1.25)}100%{transform:scale(1)}}`}</style>

      <button onClick={() => setOpen(o => !o)} title="Team chat" style={{
        position: 'fixed', right: 20, bottom: 20, zIndex: 9990,
        width: 54, height: 54, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
        boxShadow: `0 6px 20px rgba(34,211,238,0.35), 0 0 0 1px rgba(255,255,255,0.06)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: shake ? 'chatShake 0.55s ease' : 'none'
      }}>
        <ChatIcon />
        {unread > 0 && (
          <span key={unread} style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #0f1622', animation: 'chatBadgePop 0.3s ease' }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{ position: 'fixed', right: 20, bottom: 86, zIndex: 9990, width: 350, height: 470, maxHeight: 'calc(100vh - 120px)', background: PANEL_BG, border: `1px solid ${BORDER}`, borderRadius: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ChatIcon size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: TEXT, fontWeight: 800, fontSize: 13, lineHeight: 1 }}>Team Chat</div>
              <div style={{ color: TEXT2, fontSize: 10, marginTop: 2 }}>MynxDialer Admin</div>
            </div>
            <button onClick={() => setPriority(p => !p)} title={priority ? 'Priority ON — your messages pop up on agents' : 'Priority OFF — normal delivery'}
              style={{ display: 'flex', alignItems: 'center', gap: 3, background: priority ? 'rgba(239,68,68,0.18)' : 'none', border: `1px solid ${priority ? '#ef4444' : BORDER}`, borderRadius: 20, padding: '3px 8px', color: priority ? '#ef4444' : TEXT2, cursor: 'pointer', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
              ⚠ {priority ? 'Priority' : 'Normal'}
            </button>
            <button onClick={toggleSound} title={soundOn ? 'Sound ON' : 'Sound OFF'}
              style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: `1px solid ${BORDER}`, borderRadius: 20, padding: '3px 8px', color: soundOn ? ACCENT : TEXT2, cursor: 'pointer', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {soundOn ? '🔔' : '🔕'}
            </button>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: TEXT2, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', padding: '8px 8px 0', gap: 4 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); if (t.key !== 'dm') setDmUser(null); }} style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, background: tab === t.key ? CARD_BG : 'transparent', color: tab === t.key ? ACCENT : TEXT2, borderBottom: tab === t.key ? `2px solid ${ACCENT}` : '2px solid transparent' }}>{t.label}</button>
            ))}
          </div>

          {tab === 'campaign' && (
            <div style={{ padding: '8px 10px 0' }}>
              <select value={campId} onChange={e => setCampId(e.target.value)} style={{ width: '100%', background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: TEXT, fontSize: 12, padding: '7px 8px', outline: 'none' }}>
                <option value="">— choose a campaign team —</option>
                {campList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {tab === 'dm' && !dmUser ? (
            <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              <div style={{ color: TEXT2, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 6px 8px' }}>Pick someone to message</div>
              {users.length === 0 && <div style={{ color: TEXT2, fontSize: 12, padding: 10 }}>No one available.</div>}
              {users.map(u => (
                <button key={u.id} onClick={() => setDmUser(u)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', marginBottom: 4, background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: u.online ? '#10b981' : '#475569', flexShrink: 0, boxShadow: u.online ? '0 0 6px rgba(16,185,129,0.7)' : 'none' }} />
                  <span style={{ flex: 1, color: TEXT, fontSize: 13, fontWeight: 600 }}>{u.name}</span>
                  <span style={{ color: TEXT2, fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>{u.role}</span>
                </button>
              ))}
            </div>
          ) : (tab === 'campaign' && !campId) ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT2, fontSize: 12, padding: 20, textAlign: 'center' }}>Choose a campaign above to view &amp; post to its team chat.</div>
          ) : (
            <>
              {tab === 'dm' && dmUser && (
                <button onClick={() => setDmUser(null)} style={{ margin: '8px 10px 0', alignSelf: 'flex-start', background: 'none', border: 'none', color: ACCENT, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>‹ {dmUser.name}</button>
              )}
              <div ref={bodyRef} onPaste={onPaste} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.length === 0 && <div style={{ color: TEXT2, fontSize: 12, textAlign: 'center', margin: 'auto', padding: 20 }}>{tab === 'broadcast' ? 'No announcements yet.' : tab === 'campaign' ? 'No messages in this campaign yet.' : 'No messages yet.'}</div>}
                {messages.map(m => <Bubble key={m.id} m={m} mine={m.sender_id === myId} fmtTime={fmtTime} />)}
              </div>

              {pendingAtt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderTop: `1px solid ${BORDER}`, background: CARD_BG }}>
                  {pendingAtt.type === 'image' ? <img src={pendingAtt.url} alt="" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ fontSize: 16 }}>📎</span>}
                  <span style={{ flex: 1, color: TEXT, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingAtt.name}</span>
                  <button onClick={() => setPendingAtt(null)} style={{ background: 'none', border: 'none', color: TEXT2, cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              )}

              {canType && (
                <div style={{ padding: 10, borderTop: pendingAtt ? 'none' : `1px solid ${BORDER}`, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" style={{ display: 'none' }} onChange={e => { uploadFile(e.target.files[0]); e.target.value = ''; }} />
                  <button onClick={() => fileRef.current && fileRef.current.click()} title="Attach a file" disabled={attaching} style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 10, width: 38, height: 38, color: ACCENT, cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>{attaching ? '…' : '📎'}</button>
                  <input value={text} onChange={e => setText(e.target.value)} onPaste={onPaste} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={priority ? 'Priority message…' : 'Type a message… (paste an image too)'}
                    style={{ flex: 1, background: CARD_BG, border: `1px solid ${priority ? '#ef4444' : BORDER}`, borderRadius: 10, padding: '9px 12px', color: TEXT, fontSize: 13, outline: 'none' }} />
                  <button onClick={send} style={{ background: priority ? 'linear-gradient(135deg,#ef4444,#f97316)' : `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, border: 'none', borderRadius: 10, padding: '0 14px', height: 38, color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>Send</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

function Bubble({ m, mine, fmtTime }) {
  const isImg = m.attachment_url && m.attachment_type === 'image';
  const isFile = m.attachment_url && m.attachment_type !== 'image';
  const prio = !!m.priority;
  return (
    <div style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      {(!mine || prio) && (
        <div style={{ fontSize: 10, color: prio ? '#ef4444' : ACCENT, fontWeight: 800, marginBottom: 2, padding: '0 4px', textAlign: mine ? 'right' : 'left' }}>
          {!mine ? `${m.sender_name}${m.sender_role && ['admin', 'supervisor'].includes(m.sender_role) ? ' · admin' : ''}` : ''}
          {prio ? `${!mine ? ' · ' : ''}⚠ PRIORITY` : ''}
        </div>
      )}
      <div style={{ background: mine ? `linear-gradient(135deg, ${ACCENT2}, #5b21b6)` : CARD_BG, color: mine ? '#fff' : TEXT, border: prio ? '2px solid #ef4444' : (mine ? 'none' : `1px solid ${BORDER}`), boxShadow: prio ? '0 0 12px rgba(239,68,68,0.35)' : 'none', padding: '8px 11px', borderRadius: 12, fontSize: 13, lineHeight: 1.35, wordBreak: 'break-word' }}>
        {m.body}
        {isImg && <a href={m.attachment_url} target="_blank" rel="noreferrer"><img src={m.attachment_url} alt={m.attachment_name} style={{ maxWidth: '100%', borderRadius: 8, marginTop: m.body ? 6 : 0, display: 'block' }} /></a>}
        {isFile && <a href={m.attachment_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: m.body ? 6 : 0, color: mine ? '#e0e7ff' : '#7dd3fc', fontWeight: 700 }}>📎 {m.attachment_name}</a>}
      </div>
      <div style={{ fontSize: 9, color: TEXT2, marginTop: 2, textAlign: mine ? 'right' : 'left', padding: '0 4px' }}>{fmtTime(m.created_at)}</div>
    </div>
  );
}

function ChatIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}