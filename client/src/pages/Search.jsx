import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../api.js';

function Chip({ label, onClick }) {
  return (
    <button type="button" className="btn btn-sm btn-outline-secondary me-2 mb-2" onClick={onClick}>{label}</button>
  );
}

export default function Search() {
  const [q, setQ] = useState('');
  const [lang, setLang] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const canSearch = useMemo(() => q.trim().length > 1, [q]);
  const navigate = useNavigate();

  async function doSearch(customQ) {
    const query = (customQ ?? q).trim();
    if (!query) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ q: query, limit: '10' });
      if (lang) params.set('lang', lang);
      const res = await fetch(`/api/search?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function onSuggestionClick(s) {
    const next = q ? `${q} ${s}` : s;
    setQ(next);
    doSearch(next);
  }

  async function quickAdd(item) {
    try {
      await apiJson('/api/books', { method: 'POST', body: { author_name: (item.authors||[])[0] || '', title: item.title } });
      navigate('/books');
    } catch (e) { setError(e.message || 'Failed to add'); }
  }

  return (
    <div className="container mt-3">
      <h3>Find a Book</h3>
      <p className="text-muted">Describe the plot, author or title. Works with Hebrew too.</p>
      <div className="row g-2 align-items-center mb-3">
        <div className="col">
          <input className="form-control" placeholder="e.g. הילד הקוסם בבית ספר / tolkin ring" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{ if (e.key==='Enter' && canSearch) doSearch(); }} />
        </div>
        <div className="col-auto">
          <select className="form-select" value={lang} onChange={e=>setLang(e.target.value)}>
            <option value="">Auto</option>
            <option value="he">Hebrew</option>
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="es">Spanish</option>
          </select>
        </div>
        <div className="col-auto">
          <button className="btn btn-dark" disabled={!canSearch || loading} onClick={()=>doSearch()}>{loading ? 'Searching…' : 'Search'}</button>
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {data && (
        <div className="mb-3">
          <div className="text-muted small">Query used: <code>{data.query_used}</code></div>
          <div className="mt-2">
            {data.suggestions?.titleHints?.map((s,i)=>(<Chip key={'t'+i} label={`title: ${s}`} onClick={()=>onSuggestionClick(s)} />))}
            {data.suggestions?.authorHints?.map((s,i)=>(<Chip key={'a'+i} label={`author: ${s}`} onClick={()=>onSuggestionClick(s)} />))}
            {data.suggestions?.keywords?.map((s,i)=>(<Chip key={'k'+i} label={s} onClick={()=>onSuggestionClick(s)} />))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-muted">Loading results…</div>
      )}

      {data?.results?.length > 0 && (
        <div className="row row-cols-1 row-cols-md-2 g-3">
          {data.results.map((r) => (
            <div className="col" key={r.work_key}>
              <div className="card h-100">
                {r.cover_url ? (
                  <img src={r.cover_url} className="card-img-top" alt={r.title || 'Cover'} style={{ height: 220, objectFit: 'cover' }} />
                ) : (
                  <div className="card-img-top bg-light" style={{ height: 220 }} />
                )}
                <div className="card-body">
                  <h5 className="card-title mb-1">{r.title || 'Untitled'}</h5>
                  <div className="text-muted small">{(r.authors||[]).join(', ')}{r.year ? ` · ${r.year}` : ''}</div>
                  {r.description && <p className="card-text mt-2" style={{ maxHeight: 72, overflow: 'hidden' }}>{r.description}</p>}
                  {r.subjects?.length > 0 && (
                    <div className="mt-2">
                      {r.subjects.slice(0,6).map((s,i)=>(<span key={i} className="badge bg-light text-dark me-1 mb-1">{s}</span>))}
                    </div>
                  )}
                </div>
                <div className="card-footer d-flex gap-2">
                  <a href={r.openlibrary_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">OpenLibrary</a>
                  <button className="btn btn-sm btn-primary" onClick={()=>quickAdd(r)}>Add</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

