/**********************************************************************
 * Book-Notes — Express + PostgreSQL server
 *********************************************************************/

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import helmet from 'helmet';
import csurf from 'csurf';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import session from 'express-session';
import bcrypt from 'bcrypt';
import GoogleStrategy from 'passport-google-oauth2';
import pgSession from 'connect-pg-simple';
import axios from 'axios';
import { isStrongPassword } from './utils.js';

const app  = express();
app.set('trust proxy', 1);                     // behind Render’s LB
const PORT = process.env.PORT || 3000;
const onRender = process.env.DATABASE_URL?.includes('render.com');

/* ───── Database ───── */
const LOCAL_DB = 'postgres://postgres:neoray123@localhost:9977/books';
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL || LOCAL_DB,
  ssl: onRender ? { rejectUnauthorized: false } : false,
});
await db.connect();

/* ───── Force HTTPS (Render) ───── */
app.use((req, res, next) => {
  if (onRender && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

/* ───── Sessions ───── */
app.use(session({
  store: new (pgSession(session))({
    pool: db,
    createTableIfMissing: true,
    ttl: 24 * 60 * 60,
    pruneSessionInterval: 24 * 60 * 60,
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',               // HTTPS on Render, HTTP locally
    maxAge: 1000 * 60 * 60 * 24,  // 24 h
  },
}));

/* ───── Helmet with custom CSP ───── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': [
        "'self'",
        'data:',
        'https://covers.openlibrary.org',
        'https://archive.org',
      ],
    },
  },
}));

/* ───── Body parsing & static ───── */
app.use(bodyParser.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));

/* ───── Passport init ───── */
app.use(passport.initialize());
app.use(passport.session());

/* ───── Logger ───── */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ───── Schema (runs once) ───── */
await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id       SERIAL PRIMARY KEY,
    email    VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100)
  );

  CREATE TABLE IF NOT EXISTS my_books (
    id           SERIAL PRIMARY KEY,
    user_id      INT REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(100)  NOT NULL,
    introduction VARCHAR(1000) NOT NULL,
    notes        VARCHAR(10000) NOT NULL,
    author_name  VARCHAR(100)  NOT NULL,
    rating       SMALLINT      NOT NULL,
    end_date     DATE          NOT NULL,
    cover_i      INT           NOT NULL
  );
`);

/* ───── Health & OAuth routes (no CSRF) ───── */
app.get('/health', (_req, res) => res.sendStatus(200));

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

app.get('/auth/google/books',
  passport.authenticate('google', {
    successRedirect: '/books',
    failureRedirect: '/login',
  }),
);

/* ───── CSRF (after OAuth) ───── */
app.use(csurf({ ignoreMethods: ['GET', 'HEAD', 'OPTIONS'] }));
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

/* ───── Rate-limit login ───── */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
});

/* ───── Views ───── */
app.get('/', (_req, res) => res.render('home.ejs'));
app.get('/login', (_req, res) => res.render('login.ejs'));
app.get('/register', (_req, res) => res.render('register.ejs'));

/* ───── Book list ───── */
app.get('/books', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const books = (
    await db.query('SELECT * FROM my_books WHERE user_id=$1 ORDER BY id DESC', [req.user.id])
  ).rows.map(b => ({ ...b, end_date: b.end_date.toISOString().slice(0, 10) }));
  res.render('books.ejs', { books });
});

/* ───── Add form ───── */
app.get('/add', (req, res) => (req.isAuthenticated() ? res.render('add.ejs') : res.redirect('/login')));

/* ───── Add book POST ───── */
app.post('/add', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  const { author_name, book_name, rating, introduction, notes, end_date } = req.body;
  if ([author_name, book_name, rating, introduction, notes, end_date].some(x => !x)) {
    return res.status(400).send('Missing fields');
  }
  const { data } = await axios.get('https://openlibrary.org/search.json', {
    params: { title: book_name, author: author_name, limit: 1, fields: 'cover_i' },
  });
  const cover = data.docs?.[0]?.cover_i ?? 0;
  await db.query(
    'INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [book_name, introduction, notes, author_name, rating, end_date, cover, req.user.id],
  );
  res.redirect('/books');
});

/* ───── Login POST with rotation ───── */
app.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/login');
    req.session.regenerate(err2 => {
      if (err2) return next(err2);
      req.login(user, err3 => (err3 ? next(err3) : res.redirect('/books')));
    });
  })(req, res, next);
});

/* ───── Register ───── */
app.post('/register', async (req, res) => {
  const { username: email, password } = req.body;
  if (!isStrongPassword(password)) {
    return res.status(400).send('Password must be at least 8 chars with letters & numbers');
  }
  const exists = await db.query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (exists.rowCount) return res.redirect('/login');

  const hash = await bcrypt.hash(password, 10);
  const user = (await db.query(
    'INSERT INTO users (email, password) VALUES ($1,$2) RETURNING *', [email, hash],
  )).rows[0];

  req.session.regenerate(err => {
    if (err) return res.status(500).send('Session error');
    req.login(user, err2 => (err2 ? res.status(500).send('Login error') : res.redirect('/books')));
  });
});

/* ───── Passport strategies ───── */
passport.use('local', new LocalStrategy(async (username, password, cb) => {
  const user = (await db.query('SELECT * FROM users WHERE email=$1', [username])).rows[0];
  if (!user || !user.password) return cb(null, false);
  const ok = await bcrypt.compare(password, user.password);
  return cb(null, ok ? user : false);
}));

passport.use('google', new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  process.env.GOOGLE_CALLBACK_URL || 'https://book-notes-o5f0.onrender.com/auth/google/books',
  userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo',
}, async (_at, _rt, profile, cb) => {
  if (process.env.ALLOWED_GOOGLE_DOMAIN) {
    const domain = profile.email.split('@')[1];
    if (domain !== process.env.ALLOWED_GOOGLE_DOMAIN) return cb(null, false);
  }
  let user = (await db.query('SELECT * FROM users WHERE email=$1', [profile.email])).rows[0];
  if (!user) user = (await db.query('INSERT INTO users (email) VALUES ($1) RETURNING *', [profile.email])).rows[0];
  cb(null, user);
}));

passport.serializeUser((user, cb) => cb(null, user));
passport.deserializeUser((user, cb) => cb(null, user));

/* ───── Global error handler ───── */
app.use((err, _req, res, _next) => {
  console.error('UNCAUGHT:', err);
  const msg = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : String(err);
  res.status(500).send(msg);
});

/* ───── Start ───── */
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
