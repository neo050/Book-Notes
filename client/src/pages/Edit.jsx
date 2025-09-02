import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiJson } from '../api.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

export default function Edit() {
  const params = useParams();
  const [sp] = useSearchParams();
  const id = params.id || sp.get('id');
  const [book, setBook] = useState(null);
  const [error, setError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    fetch(`/api/books/${id}`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) { navigate('/login'); return null; }
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then(setBook)
      .catch(err => setError(err.message || 'Failed to load book'));
  }, [id, navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await apiJson(`/api/books/${id}`, {
        method: 'PUT',
        body: {
          introduction: book.introduction,
          notes: book.notes,
          rating: book.rating,
          end_date: book.end_date,
        }
      });
      navigate('/books');
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  }

  if (!id) return <div className="container mt-4">Missing book id</div>;
  if (!book) return <div className="container mt-4">Loading...</div>;

  return (
    <div className="box">
      <form onSubmit={onSubmit} className="m-2">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="col-md-6 mt-4 xr-4">
          <div className="row g-0 border rounded overflow-hidden flex-md-row mb-4 shadow-sm h-md-250 position-relative">
            <div className="col p-4 d-flex flex-column position-static">
              <h3 className="mb-0">{book.title}</h3>
              <strong className="d-inline-block mb-2 text-primary-emphasis">Author's name {book.author_name}</strong>
              <div className="mb-1 text-body-secondary">
                <strong>finished reading at </strong>
                <input className="form-control d-inline-block w-auto mb-2" type="date" value={book.end_date || ''} onChange={e=>setBook({...book, end_date: e.target.value})} />
                <strong>, I rate this book </strong>
                <input className="form-control d-inline-block w-auto" type="number" value={book.rating || ''} onChange={e=>setBook({...book, rating: e.target.value})} />
                <strong>/10</strong>
              </div>
              <div className="mb-3">
                <label htmlFor="introduction" className="form-label"><strong>Introduction</strong></label>
                <textarea id="introduction" className="form-control" rows="4" value={book.introduction || ''} onChange={e=>setBook({...book, introduction: e.target.value})}></textarea>
              </div>
              <div className="mb-3">
                <label htmlFor="notes" className="form-label"><strong>Notes</strong></label>
                <textarea id="notes" className="form-control" rows="6" value={book.notes || ''} onChange={e=>setBook({...book, notes: e.target.value})}></textarea>
              </div>
            </div>
            <div className="col-auto d-lg-block rounded-start p-2 m-2">
              <img
                src={`https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`}
                className="rounded-start"
                width="200"
                height="250"
                alt={`Book cover for ${book.title}`}
                loading="lazy"
              />
            </div>
          </div>
        </div>
        <div className="d-flex gap-2 mt-2">
          <button type="submit" className="btn btn-success">save</button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/books')}>cancel</button>
          <button type="button" className="btn btn-danger" onClick={() => setShowDelete(true)}>delete</button>
        </div>
      </form>
      <ConfirmModal
        show={showDelete}
        title="מחיקת ספר"
        message={`למחוק את הספר "${book?.title || ''}"? לא ניתן לבטל.`}
        confirmText="מחק"
        cancelText="ביטול"
        onCancel={() => setShowDelete(false)}
        onConfirm={async () => {
          setShowDelete(false);
          try {
            await apiJson(`/api/books/${id}`, { method: 'DELETE' });
            navigate('/books');
          } catch (e) {
            setError(e.message || 'Failed to delete');
          }
        }}
      />
    </div>
  );
}
