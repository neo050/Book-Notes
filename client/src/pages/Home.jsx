import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Home() {
  const { authenticated } = useAuth();
  return (
    <div className="box">
      <div className="jumbotron centered text-center p-4">
        <h1 className="display-6">
          Start summarizing the books you've read, editing, tracking, writing down points for memory, and rating them. 📖📕
        </h1>
        <hr />
        {!authenticated ? (
          <div className="mt-3">
            <Link className="btn btn-light btn-lg me-2" to="/register">Register</Link>
            <Link className="btn btn-dark btn-lg" to="/login">Login</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
