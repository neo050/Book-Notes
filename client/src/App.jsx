import React from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Books from './pages/Books.jsx';
import Add from './pages/Add.jsx';
import Edit from './pages/Edit.jsx';
import Continue from './pages/Continue.jsx';
import { useAuth } from './auth.jsx';
import Search from './pages/Search.jsx';

function NavBar() {
  const { authenticated } = useAuth();
  return (
    <nav className="navbar navbar-expand navbar-light bg-light mb-3">
      <div className="container-fluid">
        <Link className="navbar-brand" to="/">Book Notes</Link>
        <div className="navbar-nav">
          <Link className="nav-link" to="/books">MYBOOKS</Link>
          <Link className="nav-link" to="/search">Search</Link>
        </div>
        <div className="navbar-nav ms-auto">
          {authenticated ? (
            <a className="nav-link" href="/logout">Logout</a>
          ) : (
            <Link className="nav-link" to="/login">Login</Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <div>
      <NavBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/books" element={<Books />} />
        <Route path="/search" element={<Search />} />
        <Route path="/add" element={<Add />} />
        <Route path="/edit/:id" element={<Edit />} />
        <Route path="/continue/:id" element={<Continue />} />
        {/* Backwards compatibility for query style /edit?id=... */}
        <Route path="/edit" element={<Edit />} />
        <Route path="/continue" element={<Continue />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
