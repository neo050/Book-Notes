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
import rateLimit         from 'express-rate-limit';

import passport, { Strategy as LocalStrategy } from 'passport';
import session           from 'express-session';
import bcrypt            from 'bcrypt';
import GoogleStrategy    from 'passport-google-oauth2';
import FirestoreStore    from 'connect-session-firebase';
import axios             from 'axios';

import { isStrongPassword } from './utils.js';
import { firestore }        from './db/firestore.js';
import {
  listBooks, getBook, addBook, updateBook, deleteBook,
} from './services/books.js';

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

/*──────────────────────────── 1. HTTPS (Render) ───────────────────*/
if (process.env.RENDER) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

/*──────────────────────────── 2. Sessions ────────────────────────*/
app.use(session({
  store: new (FirestoreStore(session))({ database: firestore }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 864e5 },
}));

/*──────────────────────────── 3. Middleware ───────────────────────*/
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

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
app.get('/auth/google/books',
  passport.authenticate('google', { successRedirect: '/books', failureRedirect: '/login' }),
);

/*──────────────────────────── 6. CSRF & helpers ───────────────────*/
app.use(csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] }));
app.use((req, res, next) => { res.locals.csrfToken = req.csrfToken(); next(); });

/*──────────────────────────── 7. Rate-limit login ─────────────────*/
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });

/*──────────────────────────── 8. View routes ──────────────────────*/
app.get('/',           (_r, res) => res.render('home.ejs'));
app.get('/login',      (_r, res) => res.render('login.ejs'));
app.get('/register',   (_r, res) => res.render('register.ejs'));

/* Books list */
app.get('/books', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const books = await listBooks(req.user.id);
  books.forEach(b => b.end_date = b.end_date.toISOString().slice(0, 10));
  res.render('books.ejs', { books });
});

/* Add form */
app.get('/add', (req, res) =>
  req.isAuthenticated() ? res.render('add.ejs') : res.redirect('/login'));

/* Add book POST */
app.post('/add', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const { author_name, book_name, rating, introduction, notes, end_date } = req.body;
  if ([author_name, book_name, rating, introduction, notes, end_date].some(!Boolean))
    return res.status(400).send('Missing fields');

  const { data } = await axios.get('https://openlibrary.org/search.json', {
    params: { title: book_name, author: author_name, limit: 1, fields: 'cover_i' },
  });
  const cover = data.docs?.[0]?.cover_i ?? 0;

  await addBook(req.user.id, {
    title: book_name,
    introduction,
    notes,
    author_name,
    rating: Number(rating),
    end_date: new Date(end_date),
    cover_i: cover,
  });
  res.redirect('/books');
});

/* Edit form */
app.get('/edit', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const book = await getBook(req.user.id, req.query.id);
  if (!book) return res.status(404).send('Not found');
  book.end_date = book.end_date.toISOString().slice(0, 10);
  res.render('edit.ejs', { book });
});

/* Edit save */
app.post('/edit', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const { id, introduction, notes, rating, end_date } = req.body;
  await updateBook(req.user.id, id, {
    introduction,
    notes,
    rating: Number(rating),
    end_date: new Date(end_date),
  });
  res.redirect('/books');
});

/* Delete */
app.post('/delete', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  await deleteBook(req.user.id, req.body.id);
  res.redirect('/books');
});

/* Continue view (read-only) */
app.get('/continue', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const book = await getBook(req.user.id, req.query.id);
  if (!book) return res.status(404).send('Not found');
  book.end_date = book.end_date.toISOString().slice(0, 10);
  res.render('continue.ejs', { book });
});

/*────────────────────────── 9. Auth handlers ─────────────────────*/
app.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err || !user) return res.redirect('/login');
    req.session.regenerate(e => {
      if (e) return next(e);
      req.login(user, e2 => (e2 ? next(e2) : res.redirect('/books')));
    });
  })(req, res, next);
});

/* Register */
app.post('/register', async (req, res) => {
  const { username: email, password } = req.body;
  if (!isStrongPassword(password)) return res.status(400).send('Weak password');

  const exists = !(await firestore.collection('users').doc(email).get()).exists;
  if (exists) return res.redirect('/login');

  const hash = await bcrypt.hash(password, 10);
  await firestore.collection('users').doc(email).set({ email, password: hash });
  const user = { id: email, email };

  req.session.regenerate(err =>
    err
      ? res.status(500).send('Session error')
      : req.login(user, e => (e ? res.status(500).send('Login error') : res.redirect('/books'))),
  );
});

/* Logout */
app.get('/logout', (req, res) =>
  req.logout(err => { if (err) console.error(err); res.redirect('/'); }));

/*────────────────────────── 10. Passport strategies ──────────────*/
passport.use('local', new LocalStrategy(async (username, password, cb) => {
  const doc = await firestore.collection('users').doc(username).get();
  if (!doc.exists) return cb(null, false);
  const ok = await bcrypt.compare(password, doc.data().password);
  cb(null, ok ? { id: doc.id, ...doc.data() } : false);
}));

passport.use('google', new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'https://book-notes.onrender.com/auth/google/books',
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
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT:', err);
  res.status(500).send(process.env.NODE_ENV === 'production'
    ? 'Internal Server Error' : String(err));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
