import React, { useState, useEffect, useCallback } from 'react';
import { getNotes, addNote, editNote, deleteNote } from '../services/api';

// Option 2: notes. Persisted server-side so they double as a coaching record an
// admin can review later, and so a trainee never loses them to a refresh.
// The agent/call/lead in view is captured with each note for context.
export default function NotesPanel({ agent, context }) {
  const [notes, setNotes]   = useState([]);
  const [draft, setDraft]   = useState('');
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  const [editing, setEditing]   = useState(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    try { setNotes(await getNotes()); } catch (_) { /* transient */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setErr('');
    try {
      await addNote({
        note: text,
        agent_id:   agent?.id || null,
        agent_name: agent ? (agent.full_name || agent.username) : null,
        call_id:    context?.call_id || null,
        lead_id:    context?.lead?.id || null,
      });
      setDraft('');
      await load();
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not save note.');
    } finally {
      setBusy(false);
    }
  };

  const commitEdit = async (id) => {
    const text = editText.trim();
    if (!text) return;
    try {
      await editNote(id, text);
      setEditing(null); setEditText('');
      await load();
    } catch (_) { setErr('Could not update note.'); }
  };

  const remove = async (id) => {
    try { await deleteNote(id); await load(); }
    catch (_) { setErr('Could not delete note.'); }
  };

  // Ctrl/Cmd+Enter saves without leaving the keyboard mid-call.
  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save(e);
  };

  return (
    <div className="tr-panel">
      <div className="tr-panel-head">
        <h3>Notes</h3>
        <span className="tr-count">{notes.length}</span>
      </div>

      <form className="tr-note-form" onSubmit={save}>
        <textarea
          className="tr-textarea"
          placeholder={agent
            ? `Notes while shadowing ${agent.full_name || agent.username}…`
            : 'Write a note…'}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={4}
        />
        <div className="tr-note-actions">
          <span className="tr-hint">Ctrl/⌘ + Enter to save</span>
          <button className="tr-btn tr-btn-primary" disabled={busy || !draft.trim()}>
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
        {err && <div className="tr-login-err">{err}</div>}
      </form>

      <div className="tr-notes">
        {notes.length === 0 && <p className="tr-empty">No notes yet.</p>}
        {notes.map(n => (
          <div className="tr-note" key={n.id}>
            {editing === n.id ? (
              <>
                <textarea className="tr-textarea" rows={3}
                          value={editText} onChange={e => setEditText(e.target.value)} />
                <div className="tr-note-actions">
                  <button type="button" className="tr-btn tr-btn-ghost"
                          onClick={() => setEditing(null)}>Cancel</button>
                  <button type="button" className="tr-btn tr-btn-primary"
                          onClick={() => commitEdit(n.id)}>Save</button>
                </div>
              </>
            ) : (
              <>
                <div className="tr-note-body">{n.note}</div>
                <div className="tr-note-meta">
                  {n.agent_name ? `${n.agent_name} · ` : ''}
                  {new Date(n.created_at).toLocaleString()}
                </div>
                <div className="tr-note-tools">
                  <button type="button" onClick={() => { setEditing(n.id); setEditText(n.note); }}>Edit</button>
                  <button type="button" onClick={() => remove(n.id)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
