import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { apiJson } from '../api.js';

export default function Books() {
  const [books, setBooks] = useState([]);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState(null); // { id, title }
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    fetch('/api/books', { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) {
          navigate('/login');
          return [];
        }
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then(data => { if (mounted) setBooks(data); })
      .catch(err => setError(err.message || 'Failed to load books'));
    return () => { mounted = false; };
  }, [navigate]);

  return (
    <div className="box">
      {error && <div className="alert alert-danger m-3">{error}</div>}
      {books.map(item => (
        <div key={item.id} className="col-md-6 mt-4 mx-4">
          <div className="row g-0 border rounded overflow-hidden flex-md-row mb-4 shadow-sm h-md-250 position-relative">
            <div className="col p-4 d-flex flex-column position-static">
              <h3 className="mb-0">{item.title}</h3>
              <strong className="d-inline-block mb-2 text-primary-emphasis">Author's name {item.author_name}</strong>
              <div className="mb-1 text-body-secondary">
                finished reading at {item.end_date}, I rate this book {item.rating}/10
              </div>
              <p className="card-text mb-auto">{item.introduction}</p>
              <div className="d-inline-flex p-2 m-2">
                <Link className="btn btn-info me-2" to={`/continue/${item.id}`}>Continue reading</Link>
                <Link className="btn btn-secondary me-2" to={`/edit/${item.id}`}>edit</Link>
                <button className="btn btn-danger" onClick={() => setToDelete({ id: item.id, title: item.title })}>
                  delete
                </button>
              </div>
            </div>
            <div className="col-auto d-lg-block rounded-start p-2 m-2">
              <img
                src={`https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`}
                className="rounded-start"
                width="200"
                height="250"
                alt={`Book cover for ${item.title}`}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      ))}
      <div className="mt-4 mx-4 d-inline-flex">
        <Link to="/add" className="btn btn-primary">Add new book</Link>
      </div>
      <ConfirmModal
        show={!!toDelete}
        title="מחיקת ספר"
        message={`למחוק את הספר "${toDelete?.title || ''}"? לא ניתן לבטל.`}
        confirmText="מחק"
        cancelText="ביטול"
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          const target = toDelete;
          setToDelete(null);
          try {
            await apiJson(`/api/books/${target.id}`, { method: 'DELETE' });
            setBooks(cur => cur.filter(b => b.id !== target.id));
          } catch (e) {
            setError(e.message || 'Failed to delete');
          }
        }}
      />
    </div>
  );
}
