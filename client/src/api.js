let csrfTokenCache = null;
let csrfTokenPromise = null;

function invalidateCsrfToken() {
  csrfTokenCache = null;
  csrfTokenPromise = null;
}

export async function getCsrfToken(force = false) {
  if (force) invalidateCsrfToken();
  if (csrfTokenCache) return csrfTokenCache;
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      try {
        const res = await fetch('/api/csrf-token', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch CSRF token');
        const { csrfToken } = await res.json();
        csrfTokenCache = csrfToken;
        return csrfToken;
      } catch (err) {
        invalidateCsrfToken();
        throw err;
      } finally {
        csrfTokenPromise = null;
      }
    })();
  }
  return csrfTokenPromise;
}

export async function apiJson(path, options = {}) {
  const { method = 'GET', body, retryOnCsrf = true } = options;
  const headers = { 'Accept': 'application/json' };
  const needsCsrf = method !== 'GET' && method !== 'HEAD';
  let payload;
  if (needsCsrf) {
    const token = await getCsrfToken();
    headers['Content-Type'] = 'application/json';
    headers['x-csrf-token'] = token;
    payload = body ? JSON.stringify(body) : undefined;
  }
  const res = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'include',
  });
  if (res.status === 403 && needsCsrf && retryOnCsrf) {
    invalidateCsrfToken();
    return apiJson(path, { ...options, retryOnCsrf: false });
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 && needsCsrf) invalidateCsrfToken();
    throw new Error(text || ('Request failed: ' + res.status));
  }
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
  if (!res.ok) {
    if (res.status === 403) invalidateCsrfToken();
    throw new Error(await res.text());
  }
  invalidateCsrfToken();
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
  if (!res.ok) {
    if (res.status === 403) invalidateCsrfToken();
    throw new Error(await res.text());
  }
  invalidateCsrfToken();
  return res.json();
}
