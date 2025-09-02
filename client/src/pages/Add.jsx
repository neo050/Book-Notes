import React, { useState } from 'react';
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

  return (
    <div className="box">
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
