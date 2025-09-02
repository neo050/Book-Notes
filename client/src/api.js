let csrfTokenCache = null;

export async function getCsrfToken() {
  if (csrfTokenCache) return csrfTokenCache;
  const res = await fetch('/api/csrf-token', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch CSRF token');
  const { csrfToken } = await res.json();
  csrfTokenCache = csrfToken;
  return csrfToken;
}

export async function apiJson(path, { method = 'GET', body } = {}) {
  const headers = { 'Accept': 'application/json' };
  let payload;
  if (method !== 'GET' && method !== 'HEAD') {
    const token = await getCsrfToken();
    headers['Content-Type'] = 'application/json';
    headers['x-csrf-token'] = token; // csurf accepts standard headers
    payload = body ? JSON.stringify(body) : undefined;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  // Some endpoints may return empty
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

export async function login(username, password) {
  const token = await getCsrfToken();
  const form = new URLSearchParams();
  form.set('_csrf', token);
  form.set('username', username);
  form.set('password', password);
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    body: form,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function register(username, password) {
  const token = await getCsrfToken();
  const form = new URLSearchParams();
  form.set('_csrf', token);
  form.set('username', username);
  form.set('password', password);
  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Accept': 'application/json' },
    body: form,
    credentials: 'include',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

