import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { apiJson } from '../api.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

export default function Continue() {
  const params = useParams();
  const [sp] = useSearchParams();
  const id = params.id || sp.get('id');
  const [book, setBook] = useState(null);
  const [error, setError] = useState('');
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

  const [showDelete, setShowDelete] = useState(false);

  if (!id) return <div className="container mt-4">Missing book id</div>;
  if (!book) return <div className="container mt-4">Loading...</div>;

  return (
    <div className="box">
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="col-md-6 mt-4 mx-4">
        <div className="row g-0 border rounded overflow-hidden flex-md-row mb-4 shadow-sm h-md-250 position-relative">
          <div className="col p-4 d-flex flex-column position-static">
            <h3 className="mb-0">{book.title}</h3>
            <strong className="d-inline-block mb-2 text-primary-emphasis">Author's name {book.author_name}</strong>
            <div className="mb-1 text-body-secondary">finished reading at {book.end_date}, I rate this book {book.rating}/10</div>
            <div className="mb-3">
              <strong>Introduction</strong>
              <div>{book.introduction}</div>
            </div>
            <div className="mb-3">
              <strong>Notes</strong>
              <div>{book.notes}</div>
            </div>
            <div className="d-inline-flex p-2 m-2">
              <Link className="btn btn-success me-2" to="/books">Finished reading</Link>
              <Link className="btn btn-secondary me-2" to={`/edit/${book.id}`}>edit</Link>
              <button className="btn btn-danger" onClick={() => setShowDelete(true)}>delete</button>
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
