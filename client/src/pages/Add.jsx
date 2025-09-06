import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../api.js';

export default function Add() {
  const [title, setTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rating, setRating] = useState('');
  const [introduction, setIntroduction] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await apiJson('/api/books', {
        method: 'POST',
        body: {
          title,
          author_name: authorName,
          end_date: endDate || undefined,
          rating: rating || undefined,
          introduction,
          notes,
        },
      });
      navigate('/books');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  }

  // Debounced search to /api/ol-search
  useEffect(() => {
    let stopped = false;
    const term = q.trim();
    if (!term) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ol-search?q=${encodeURIComponent(term)}`, { credentials: 'include' });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (!stopped) setResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!stopped) setResults([]);
      } finally {
        if (!stopped) setLoading(false);
      }
    }, 350);
    return () => { stopped = true; clearTimeout(t); };
  }, [q]);

  async function quickAdd(item) {
    try {
      await apiJson('/api/books', {
        method: 'POST',
        body: {
          author_name: item.author_name,
          title: item.title,
        },
      });
      navigate('/books');
    } catch (e) {
      setError(e.message || 'Failed to add book');
    }
  }

  return (
    <div className="box">
      <div className="container mt-3">
        <h4 className="mb-2">Search and add a book</h4>
        <div className="input-group mb-3">
          <span className="input-group-text">🔎</span>
          <input
            type="text"
            className="form-control"
            placeholder="Search by title, author, or description"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        {loading && <div className="text-muted mb-2">Searching…</div>}
        {results.length > 0 && (
          <div className="row row-cols-2 row-cols-md-3 g-3 mb-4">
            {results.map((r, i) => (
              <div key={r.id + i} className="col">
                <div className="card h-100">
                  {r.cover_i ? (
                    <img
                      src={`https://covers.openlibrary.org/b/id/${r.cover_i}-L.jpg`}
                      className="card-img-top"
                      alt={`Cover ${r.title}`}
                      style={{ height: 220, objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="card-img-top bg-light" style={{ height: 220 }} />
                  )}
                  <div className="card-body">
                    <h6 className="card-title mb-1" title={r.title}>{r.title}</h6>
                    <div className="text-muted small">{r.author_name}</div>
                  </div>
                  <div className="card-footer d-flex gap-2">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => quickAdd(r)}
                    >
                      Add
                    </button>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => { setTitle(r.title || ''); setAuthorName(r.author_name || ''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    >
                      Prefill
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="m-2">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="col-md-6 mt-4 xr-4">
          <div className="row g-0 border rounded overflow-hidden flex-md-row mb-4 shadow-sm h-md-250 position-relative">
            <div className="col p-4 d-flex flex-column position-static">
              <h3 className="mb-0">Book name
                <input className="form-control mb-2" type="text" value={title} onChange={e=>setTitle(e.target.value)} required />
              </h3>
              <strong className="d-inline-block mb-2 text-primary-emphasis">Author's name</strong>
              <input className="form-control mb-2" type="text" value={authorName} onChange={e=>setAuthorName(e.target.value)} required />
              <div className="mb-1 text-body-secondary">
                <strong>finished reading at </strong>
                <input className="form-control d-inline-block w-auto mb-2" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
                <strong>, I rate this book </strong>
                <input className="form-control d-inline-block w-auto" type="number" value={rating} onChange={e=>setRating(e.target.value)} />
                <strong>/10</strong>
              </div>
              <div className="mb-3">
                <label htmlFor="introduction" className="form-label"><strong>Introduction</strong></label>
                <textarea id="introduction" className="form-control" rows="4" value={introduction} onChange={e=>setIntroduction(e.target.value)}></textarea>
              </div>
              <div className="mb-3">
                <label htmlFor="notes" className="form-label"><strong>Notes</strong></label>
                <textarea id="notes" className="form-control" rows="6" value={notes} onChange={e=>setNotes(e.target.value)}></textarea>
              </div>
            </div>
          </div>
        </div>
        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-success">save</button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/books')}>cancel</button>
        </div>
      </form>
    </div>
  );
}
