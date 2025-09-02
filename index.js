/********************************************************************
 * Book-Notes — Express + Firestore
 ********************************************************************/
import 'dotenv/config';
if (process.env.NODE_ENV !== 'test') {
  await import('./cron.js');
}
import express           from 'express';
import path              from 'path';
import { fileURLToPath } from 'url';
import bodyParser        from 'body-parser';
import helmet            from 'helmet';
import csurf             from 'csurf';
import rateLimit         from 'express-rate-limit';
import { existsSync }    from 'node:fs';

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



export const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
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
// Only enable React SPA if a build exists (unless explicitly disabled)
USE_REACT = USE_REACT && existsSync(path.join(__dirname, 'client', 'dist'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));


app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));

app.use(passport.initialize());
app.use(passport.session());



/*──────────────────────────── 4. Logger ──────────────────────────*/
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/*──────────────────────────── 5. Routes (no-CSRF) ────────────────*/
app.get('/health', (_req, res) => res.sendStatus(200));

/* Google OAuth */
app.get('/auth/google',
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
  app.get('/',       withCsrf,    (_r, res) => res.render('home.ejs'));
  app.get('/login',  withCsrf ,   (_r, res) => res.render('login.ejs'));
  app.get('/register',  withCsrf, (_r, res) => res.render('register.ejs'));

  /* Books list */
  app.get('/books',withCsrf, async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const books = await listBooks(req.user.id);
    books.forEach(b => b.end_date = b.end_date
     ? b.end_date.toDate().toISOString().slice(0, 10)
     : '');
    res.render('books.ejs', { books });
  });

  /* Add form */
  app.get('/add',withCsrf, (req, res) =>
    req.isAuthenticated() ? res.render('add.ejs') : res.redirect('/login'));
}


//  Semantic search helper
app.get('/api/ol-search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).send('q missing');
  const hits = await searchWorks(q);
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

  await addBook(req.user.id, clean({
    title: book_name,
    introduction,
    notes,
    author_name,
    rating: rating ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
    cover_i: cover,
  }));

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
     rating: rating ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
  }));
  res.redirect('/books');
});

/* Delete */
app.post('/delete',csrfProtection, async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  await deleteBook(req.user.id, req.body.id);
  res.redirect('/books');
});

/* Continue view (read-only) */
if (!USE_REACT) {
  app.get('/continue', withCsrf,async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/');
    const book = await getBook(req.user.id, req.query.id);
    if (!book) return res.status(404).send('Not found');
    book.end_date = book.end_date ? book.end_date.toDate().toISOString().slice(0, 10): '';
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
app.post('/login', csrfProtection,loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err || !user) return res.redirect('/login');
    req.session.regenerate(e => {
      if (e) return next(e);
      req.login(user, e2 => {
        if (e2) return next(e2);
        const wantsJson = req.headers.accept?.includes('application/json') || req.is('application/json');
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
  req.logout(err => { if (err) console.error(err); res.redirect('/'); }));



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
  console.error('UNCAUGHT:', err);
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
  const { introduction, notes, rating, end_date } = req.body || {};
  const patch = clean({
    introduction,
    notes,
    rating: (rating || rating === 0) && String(rating).trim() !== '' ? Number(rating) : undefined,
    end_date: end_date ? new Date(end_date) : undefined,
  });
  await updateBook(req.user.id, req.params.id, patch);
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

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}
