import React, { useState, useEffect, useCallback, useRef } from 'react';
import { adminAPI } from '../services/api';

export default function DNCList() {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [addPhone, setAddPhone] = useState('');
  const [addReason, setAddReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState(null);
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminAPI.dnc({ search, page, limit: 50 });
      setList(data.list || []);
      setTotal(data.total || 0);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async e => {
    e.preventDefault(); setAdding(true);
    try {
      await adminAPI.addDNC({ phone: addPhone.replace(/\D/g, ''), reason: addReason });
      setAddPhone(''); setAddReason('');
      load();
    } catch (err) { alert(err.error || 'Failed'); }
    finally { setAdding(false); }
  };

  const handleDelete = async id => {
    if (!window.confirm('Remove from DNC?')) return;
    await adminAPI.deleteDNC(id);
    load();
  };

  const handleBulkAdd = async () => {
    const phones = bulkText.split(/[\n,;]+/).map(p => p.trim()).filter(p => p.replace(/\D/g, '').length >= 7);
    if (!phones.length) return;
    const result = await adminAPI.bulkDNC(phones).catch(e => ({ error: e.error }));
    setBulkResult(result);
    if (!result.error) { setBulkText(''); load(); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">DNC List</h1>
          <p className="page-subtitle">{total.toLocaleString()} numbers on DNC list</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={() => setShowBulk(!showBulk)}>Bulk Import</button>
        </div>
      </div>

      {/* Add form */}
      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, maxWidth: 240 }}>
            <div className="form-label" style={{ marginBottom: 4 }}>Phone Number</div>
            <input className="input" value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="e.g. 18005551234" required />
          </div>
          <div style={{ flex: 1, maxWidth: 300 }}>
            <div className="form-label" style={{ marginBottom: 4 }}>Reason</div>
            <input className="input" value={addReason} onChange={e => setAddReason(e.target.value)} placeholder="Optional reason" />
          </div>
          <button type="submit" className="btn btn-danger" disabled={adding}>{adding ? 'Adding...' : '+ Add to DNC'}</button>
        </form>
      </div>

      {showBulk && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3 className="card-title">Bulk Import</h3>
          </div>
          <div className="form-group">
            <label className="form-label">Phone numbers (one per line, or comma/semicolon separated)</label>
            <textarea className="textarea" rows={6} value={bulkText} onChange={e => setBulkText(e.target.value)}
              placeholder="18005551234&#10;18005555678&#10;..." />
          </div>
          {bulkResult && (
            <div className={`alert ${bulkResult.error ? 'alert-error' : 'alert-success'}`}>
              {bulkResult.error || `Added ${bulkResult.added} numbers to DNC`}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-danger" onClick={handleBulkAdd}>Import</button>
            <button className="btn btn-secondary" onClick={() => { setShowBulk(false); setBulkText(''); setBulkResult(null); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <input className="input" style={{ width: 280 }} placeholder="Search phone number..."
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Reason</th>
                <th>Added By</th>
                <th>Date Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(e => (
                <tr key={e.id}>
                  <td className="mono" style={{ fontSize: 14, color: 'var(--danger)' }}>{e.phone}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{e.reason || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{e.added_by_name || 'System'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{new Date(e.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(e.id)}>Remove</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                  {search ? 'No matches' : 'DNC list is empty'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {total > 50 && (
        <div className="pagination" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span className="page-info">Page {page} · {total.toLocaleString()} total</span>
          <button className="btn btn-secondary btn-sm" disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
