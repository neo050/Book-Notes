import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AuthCtx = createContext({ loading: true, authenticated: false, user: null, refresh: () => {} });

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, authenticated: false, user: null });

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' });
      const data = await res.json();
      setState({ loading: false, authenticated: !!data.authenticated, user: data.user || null });
    } catch {
      setState({ loading: false, authenticated: false, user: null });
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  return (
    <AuthCtx.Provider value={{ ...state, refresh: fetchMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}

