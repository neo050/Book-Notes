import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { register as registerApi } from '../api.js';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await registerApi(email, password);
      navigate('/books');
    } catch (err) {
      setError(err.message || 'Register failed');
    }
  }

  return (
    <div className="container mt-5">
      <h1>Register</h1>
      <div className="row">
        <div className="col-sm-8">
          <div className="card">
            <div className="card-body">
              <form onSubmit={onSubmit}>
                {error && <div className="alert alert-danger">{error}</div>}
                <div className="mb-3">
                  <label htmlFor="email" className="form-label">Email</label>
                  <input id="email" className="form-control" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
                </div>
                <div className="mb-3">
                  <label htmlFor="password" className="form-label">Password</label>
                  <input id="password" className="form-control" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
                </div>
                <button type="submit" className="btn btn-dark">Register</button>
              </form>
            </div>
          </div>
        </div>
        <div className="col-sm-4">
          <div className="card">
            <div className="card-body">
              <a className="btn btn-outline-secondary w-100" href="/auth/google">Sign Up with Google</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

