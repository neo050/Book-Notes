/********************************************************************
 * Book-Notes — Express + Firestore
 ********************************************************************/
import 'dotenv/config';
import express           from 'express';
import path              from 'path';
import { fileURLToPath } from 'url';
import bodyParser        from 'body-parser';
import helmet            from 'helmet';
import csurf             from 'csurf';
import { rateLimit } from 'express-rate-limit';
import { existsSync }    from 'node:fs';
import { logger }        from './utils/logger.js';
import { randomUUID }    from 'node:crypto';

import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session           from 'express-session';
import bcrypt            from 'bcrypt';
import GoogleStrategy    from 'passport-google-oauth2';
import axios             from 'axios';

import { isStrongPassword } from './utils.js';
import { firestore }        from './db/firestore.js';
import {
  listBooks, getBook, addBook, updateBook, deleteBook,
} from './services/books.js';
import { searchWorks } from './services/olSearch.js';
import { handleRagSearch, ensureSchema } from './services/ragSearch.js';
import { UpdateBookSchema } from './validation/schemas.js';



export const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 38796;
let USE_REACT = process.env.USE_REACT !== 'false';


/*──────────────────────────── 2. Sessions ────────────────────────*/
const useMemorySessions = process.env.NODE_ENV === 'test';
let sessionStoreResolved;
if (useMemorySessions) {
  sessionStoreResolved = new session.MemoryStore();
} else {
  const mod = await import('./db/firestoreSession.js');
  sessionStoreResolved = mod.storeInstance;
}
app.use(session({
  store: sessionStoreResolved,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 864e5 },
}));


app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Request correlation + structured logging
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || randomUUID();
  req.id = reqId;
  const start = Date.now();
  const child = logger.child({ component: 'http', reqId, method: req.method, url: req.originalUrl });
  req.log = child;
  child.info('request.start', { ip: req.ip, ua: req.headers['user-agent'] });
  res.on('finish', () => {
    const ms = Date.now() - start;
    child.info('request.finish', { status: res.statusCode, ms, length: res.getHeader('content-length') });
  });
  next();
});


/*──────────────────────────── 6. CSRF & helpers ───────────────────*/

 const csrfProtection = csurf({ ignoreMethods: ['GET','HEAD','OPTIONS'] });
 const attachToken = (req,res,next) => { res.locals.csrfToken = req.csrfToken(); next(); };

 const withCsrf = [csrfProtection, attachToken];




// app.use((req,res,next)=>{

//   if (req.method === 'GET') console.log('token sent:', res.locals.csrfToken);
//   if (req.method === 'POST') console.log('token received:', req.body?._csrf);
//   next();
// });

/*──────────────────────────── 1. HTTPS (Render) ───────────────────*/
if (process.env.RENDER) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}





/*──────────────────────────── 3. Middleware ───────────────────────*/
      /* ───────────────────────────
        . Helmet - CSP fix
      ─────────────────────────── */

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,           // keeps Helmet’s standard policy set
    directives: {
      imgSrc: [                  // camelCase key 
        "'self'",
        "data:",
        "https://covers.openlibrary.org",
        "https://archive.org",
        "https://*.archive.org",
        "https://*.us.archive.org",
      ],
    },
  }),
);


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const envAllowsReact = USE_REACT;
const clientDistPath = path.join(__dirname, 'client', 'dist');
const hasClientBuild = existsSync(clientDistPath);
// Only enable React SPA if a build exists (unless explicitly disabled)
USE_REACT = envAllowsReact && hasClientBuild;
const bootLogger = logger ?? console;
bootLogger.info('startup.renderer', { envAllowsReact, hasClientBuild, mode: USE_REACT ? 'react' : 'ejs' });
if (envAllowsReact && !hasClientBuild) {
  bootLogger.warn('startup.react-missing-build', { clientDistPath });
}
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));

app.use(passport.initialize());
app.use(passport.session());

// Ensure DB schema (vector + FTS) on startup
await ensureSchema();

/*──────────────────────────── 5. Routes (no-CSRF) ────────────────*/
app.get('/health', (req, res) => { (req.log||console).info('health.ping'); res.sendStatus(200); });
// Prometheus metrics
import { register, httpRequestDuration, routeLabel } from './utils/metrics.js';
import { authorizeMetrics } from './utils/secure.js';
// Strictly protected metrics endpoint (Bearer token + optional IP allowlist)
const metricsLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });
app.get('/metrics', authorizeMetrics, metricsLimiter, async (_req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch {
    res.status(500).send('metrics error');
  }
});

/* Google OAuth */
app.get('/auth/google',
  (req, _res, next) => { console.log('auth.google.start'); next(); },
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);
app.get('/auth/google/books', (req, res, next) => {
  passport.authenticate('google', (err, user) => {
    if (err) {
      console.error('Google OAuth error:', err);
      return res.redirect('/login');
    }
    if (!user) return res.redirect('/login');
    req.session.regenerate(e => {
      if (e) return next(e);
      req.login(user, e2 => (e2 ? next(e2) : res.redirect('/books')));
    });
  })(req, res, next);
});



/*──────────────────────────── 7. Rate-limit login ─────────────────*/
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

/*──────────────────────────── 8. View routes ──────────────────────*/
if (!USE_REACT) {
  app.get('/',       withCsrf,    (req, res) => { (req.log||console).info('view.home'); res.render('home.ejs'); });
  app.get('/login',  withCsrf ,   (req, res) => { (req.log||console).info('view.login'); res.render('login.ejs'); });
  app.get('/register',  withCsrf, (req, res) => { (req.log||console).info('view.register'); res.render('register.ejs'); });

  /* Books list */
  app.get('/books',withCsrf, async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const books = await listBooks(req.user.id);
    books.forEach(b => b.end_date = b.end_date
     ? b.end_date.toDate().toISOString().slice(0, 10)
     : '');
    (req.log||console).info('view.books', { count: books.length });
    res.render('books.ejs', { books });
  });

  /* Add form */
  app.get('/add',withCsrf, (req, res) => {
    (req.log||console).info('view.add');
    return req.isAuthenticated() ? res.render('add.ejs') : res.redirect('/login');
  });
}


//  Semantic search helper
app.get('/api/ol-search', async (req, res) => {
  const { q, lang } = req.query;
  if (!q) return res.status(400).send('q missing');
  const hits = await searchWorks(q, { lang });
  (req.log||console).info('api.ol.search', { q: String(q).slice(0,120), hits: hits.length });
  res.json(hits);
});
// helper: remove keys whose value === undefined
const clean = obj =>
  Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));

app.post('/add',csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { author_name, book_name, rating, introduction, notes, end_date } = req.body;

  // only author & title are mandatory
  if ([author_name, book_name].some(v => !v))
    return res.status(400).send('Missing title or author');

  const { data } = await axios.get('https://openlibrary.org/search.json', {
    params: { title: book_name, author: author_name, limit: 1, fields: 'cover_i' },
  });
  const cover = data.docs?.[0]?.cover_i ?? 0;

  const payload = clean({
    title: book_name,
    introduction,
    notes,
    author_name,
    rating: (rating || rating === 0) && String(rating).trim() !== '' ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
    cover_i: cover,
  });
  (req.log||console).info('form.add.submit', { title: payload.title, author: payload.author_name });
  await addBook(req.user.id, payload);
  (req.log||console).info('form.add.saved');
  res.redirect('/books');
});

/* Edit form */
if (!USE_REACT) {
  app.get('/edit', withCsrf,async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const book = await getBook(req.user.id, req.query.id);
    if (!book) return res.status(404).send('Not found');
    book.end_date = book.end_date
      ? book.end_date.toDate().toISOString().slice(0, 10)
      : '';
    (req.log||console).info('view.edit', { id: req.query.id });
    res.render('edit.ejs', { book });
  });
}

/* Edit save */
app.post('/edit',csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const { id, introduction, notes, rating, end_date } = req.body;
  await updateBook(req.user.id, id, clean({
    introduction,
    notes,
    rating: (rating || rating === 0) && String(rating).trim() !== '' ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
  }));
  (req.log||console).info('form.edit.saved', { id });
  res.redirect('/books');
});

/* Delete */
app.post('/delete',csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  await deleteBook(req.user.id, req.body.id);
  (req.log||console).info('form.delete.saved', { id: req.body.id });
  res.redirect('/books');
});

/* Continue view (read-only) */
if (!USE_REACT) {
  app.get('/continue', withCsrf,async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const book = await getBook(req.user.id, req.query.id);
    if (!book) return res.status(404).send('Not found');
    book.end_date = book.end_date ? book.end_date.toDate().toISOString().slice(0, 10): '';
    (req.log||console).info('view.continue', { id: req.query.id });
    res.render('continue.ejs', { book });
  });
}

/*────────────────────────── . Passport strategies ──────────────*/
passport.use('local', new LocalStrategy(async (username, password, cb) => {
  const doc = await firestore.collection('users').doc(username).get();
  if (!doc.exists) return cb(null, false);
  const ok = await bcrypt.compare(password, doc.data().password);
  cb(null, ok ? { id: doc.id, ...doc.data() } : false);
}));


/*────────────────────────── 9. Auth handlers ─────────────────────*/
app.post('/login', csrfProtection,loginLimiter, async (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err || !user) { console.warn('auth.local.failed'); return res.redirect('/login'); }
    req.session.regenerate(e => {
      if (e) return next(e);
      req.login(user, e2 => {
        if (e2) return next(e2);
        const wantsJson = req.headers.accept?.includes('application/json') || req.is('application/json');
        console.log('auth.local.success', user.id);
        if (wantsJson) return res.json({ ok: true });
        return res.redirect('/books');
      });
    });
  })(req, res, next);
});

/* Register */
app.post('/register',csrfProtection, async (req, res) => {
  const { username: email, password } = req.body;
  if (!isStrongPassword(password)) return res.status(400).send('Weak password');

 const snap = await firestore.collection('users').doc(email).get();
    if (snap.exists) {
      return res.redirect('/login'); 
    }

  const hash = await bcrypt.hash(password, 10);
  await firestore.collection('users').doc(email).set({ email, password: hash });
  const user = { id: email, email };

  req.session.regenerate(err => {
    if (err) return res.status(500).send('Session error');
    req.login(user, e => {
      if (e) return res.status(500).send('Login error');
      const wantsJson = req.headers.accept?.includes('application/json') || req.is('application/json');
      if (wantsJson) return res.json({ ok: true });
      return res.redirect('/books');
    });
  });
});

/* Logout */
app.get('/logout', (req, res) =>
  req.logout(err => { if (err) console.error(err); console.log('auth.logout.success'); res.redirect('/'); }));



passport.use('google', new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.CALL_BACK_URL,
}, async (_at, _rt, profile, cb) => {
  const allowed = process.env.ALLOWED_GOOGLE_DOMAIN;
  if (allowed && profile.email.split('@')[1] !== allowed) return cb(null, false);

  const ref  = firestore.collection('users').doc(profile.email);
  const doc  = await ref.get();
  if (!doc.exists) await ref.set({ email: profile.email });

  cb(null, { id: profile.email, email: profile.email });
}));

passport.serializeUser((user, cb)   => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

/*────────────────────────── 11. Errors & Start ───────────────────*/
app.use((err, req, res, _next) => {
  (req?.log || logger).error('uncaught.error', {
    message: String(err?.message || err),
    code: err?.code,
    detail: err?.detail,
    stack: err?.stack,
  });
  if (res.headersSent) return;
  const wantsJson = req.path.startsWith('/api') || req.headers.accept?.includes('application/json');
  if (wantsJson) return res.status(500).json({ error: 'Internal Server Error' });
  res.status(500).send('Internal Server Error');
});

/*──────────────────────────── 12. JSON APIs ───────────────────────*/
// CSRF token fetcher for SPA
app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Session info
app.get('/api/me', (req, res) => {
  const user = req.user ? { id: req.user.id, email: req.user.email } : null;
  res.json({ authenticated: !!req.user, user });
});

// Books REST API
const ensureAuth = (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Helper to normalize Firestore Timestamp/Date/string -> 'YYYY-MM-DD'
function normalizeDate(v) {
  if (!v) return '';
  if (v && typeof v.toDate === 'function') v = v.toDate();
  if (typeof v === 'string') v = new Date(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return '';
}

const toPlainBook = b => ({
  ...b,
  end_date: normalizeDate(b?.end_date),
});

app.get('/api/books', ensureAuth, async (req, res) => {
  const books = await listBooks(req.user.id);
  res.json(books.map(({ id, ...rest }) => ({ id, ...toPlainBook(rest) })));
});

app.get('/api/books/:id', ensureAuth, async (req, res) => {
  const book = await getBook(req.user.id, req.params.id);
  if (!book) return res.status(404).json({ error: 'Not found' });
  const { id, ...rest } = book;
  res.json({ id, ...toPlainBook(rest) });
});

app.post('/api/books', ensureAuth, csrfProtection, async (req, res) => {
  const { author_name, title, rating, introduction, notes, end_date } = req.body || {};
  if ([author_name, title].some(v => !v)) return res.status(400).json({ error: 'Missing title or author' });

  const { data } = await axios.get('https://openlibrary.org/search.json', {
    params: { title, author: author_name, limit: 1, fields: 'cover_i' },
  });
  const cover = data.docs?.[0]?.cover_i ?? 0;

  const ref = await addBook(req.user.id, clean({
    title,
    introduction,
    notes,
    author_name,
    rating: (rating || rating === 0) && String(rating).trim() !== '' ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
    cover_i: cover,
  }));
  res.status(201).json({ id: ref.id });
});

app.put('/api/books/:id', ensureAuth, csrfProtection, async (req, res) => {
  // Coerce rating to number when provided; normalize end_date to Date
  const { introduction, notes, rating, end_date, ...rest } = req.body || {};
  const patchRaw = clean({
    ...rest,
    introduction,
    notes,
    rating: (rating || rating === 0) && String(rating).trim() !== '' ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
  });

  const parsed = UpdateBookSchema.safeParse(patchRaw);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  await updateBook(req.user.id, req.params.id, parsed.data);
  res.json({ ok: true });
});

app.delete('/api/books/:id', ensureAuth, csrfProtection, async (req, res) => {
  await deleteBook(req.user.id, req.params.id);
  res.json({ ok: true });
});

/*──────────────────────────── 13. Serve React SPA ────────────────*/
if (USE_REACT) {
  const reactDist = path.join(__dirname, 'client', 'dist');
  if (existsSync(reactDist)) {
    app.use(express.static(reactDist));
    // SPA fallback: serve index.html for any non-API route
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(reactDist, 'index.html'));
    });
  }
}

// RAG search — returns rich results; require auth consistent with app
app.get('/api/search', ensureAuth, async (req, res) => {
  (req.log||console).info('api.rag.search.start', { q: String(req.query?.q||'').slice(0,120) });
  await handleRagSearch(req, res);
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}
