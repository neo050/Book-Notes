/**********************************************************************
 * Book-Notes — Express + PostgreSQL server
 * Works locally (no SSL) and on Render (SSL required)
 *********************************************************************/

import 'dotenv/config';                       // loads .env
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import pg from 'pg';
import axios from 'axios';
import helmet from 'helmet';
import csurf from 'csurf';
import rateLimit from 'express-rate-limit';
import { isStrongPassword } from './utils.js';

import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import GoogleStrategy from "passport-google-oauth2"
import pgSession from 'connect-pg-simple';
/* ───────────────────────────
   1. APP & STATIC FILES
─────────────────────────── */
const app  = express();
app.set('trust proxy', 1); 
const PORT = process.env.PORT || 3000;
const saltRounds = 10;


/* ───────────────────────────
   2. DATABASE
─────────────────────────── */
const LOCAL_DB      = 'postgres://postgres:neoray123@localhost:9977/books';
const connectionURL = process.env.DATABASE_URL || LOCAL_DB;

const db = new pg.Client({
  connectionString: connectionURL,
  ssl: connectionURL.includes('render.com')
       ? { rejectUnauthorized: false }   // Render external URL
       : false                           // no SSL on localhost
});
await db.connect();
const onRender = process.env.DATABASE_URL?.includes('render.com');
/* ───────────────────────────────
   HTTPS ENFORCEMENT on Render
──────────────────────────────── */
app.use((req, res, next) => {
  // if on Render and not HTTPS, redirect to HTTPS
  if (onRender && req.headers['x-forwarded-proto'] !== 'https') {
    const host = req.headers.host;
    const url  = req.originalUrl || req.url;
    return res.redirect(301, 'https://' + host + url);
  }
  next();
});
app.use(
  session({
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
      secure: onRender,
      maxAge: 86400000,
    },
  }),
);



const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(helmet());

app.use(csurf());
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});


app.use(passport.initialize());
app.use(passport.session());

/* ───────────────────────────────
   DEBUG LOGGER – prints every hit
──────────────────────────────── */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});




app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));




await db.query(`
  CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
 
  email        VARCHAR(100) UNIQUE  NOT NULL,

  password  VARCHAR(100)
 
);
`);


await db.query(`
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



/* ───────────────────────────
   3. ROUTES
─────────────────────────── */

/* Health check (use /health on Render) */
app.get('/health', (_req, res) => res.sendStatus(200));

/* Home — list books */
app.get("/", (req, res) => {
  res.render("home.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get('/books', async (_req, res) => {
  if (_req.isAuthenticated()) {
    try {
      const result = await db.query('SELECT * FROM my_books WHERE user_id =$1 ORDER BY id DESC',[_req.user.id]
      );
      const books  = result.rows.map(b => ({
        ...b,
        end_date: new Date(b.end_date).toISOString().slice(0, 10)
      }));
      res.render('books.ejs', { books });
    } catch (err) {
      console.error('DB error:', err);
      res.status(500).send('Database error.');
    }
  } else {
    res.redirect("/");
  }
});

/* Add book form */
app.get('/add', (_req, res) => 
  {
    console.log(_req.user);
  if (_req.isAuthenticated()) {
      res.render('add.ejs')
  } else {
      res.redirect("/login");
  }
  
  });

app.get("/auth/google",
  passport.authenticate("google" ,
  {

    scope:["profile","email"],
  }
));

app.get("/auth/google/books",
  passport.authenticate("google",{
  successRedirect:"/books",
  failureRedirect:"/login",
}));

app.get("/logout",(req,res)=>{
  req.logout((err)=>{
    if(err) console.log(err);
      res.redirect("/");
  });

});
/* Add book (POST) */
app.post('/add', async (req, res) => {

   console.log(req.user);
  if (req.isAuthenticated()) {
    const { author_name, book_name, rating, introduction, notes, end_date } = req.body;
    if (!author_name || !book_name || !rating || !introduction || !notes || !end_date) {
      return res.status(400).send('Missing fields');
    }

    try {
      const { data } = await axios.get('https://openlibrary.org/search.json', {
        params: { title: book_name, author: author_name, limit: 1, fields: 'cover_i' },
      });

      const cover = data.docs?.[0]?.cover_i ?? 0;

      await db.query(
        'INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i,user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [book_name, introduction, notes, author_name, rating, end_date, cover,req.user.id]
      );
      res.redirect('/books');
    } catch (err) {
      console.error('Add book failed:', err);
      res.status(500).send('Failed to add book.');
    }
   } else {
    res.redirect("/");
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) return res.redirect('/login');
    req.session.regenerate((err2) => {
      if (err2) return next(err2);
      req.login(user, (err3) => {
        if (err3) return next(err3);
        res.redirect('/books');
      });
    });
  })(req, res, next);
});



app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      return res.redirect("/login");
    } else {
      if (!isStrongPassword(password)) {
        return res.status(400).send('Password must be at least 8 characters and contain letters and numbers');
      }
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.session.regenerate((err2) => {
            if (err2) return res.status(500).send('Session error');
            req.login(user, (err3) => {
              if (err3) return res.status(500).send('Login error');
              res.redirect("/books");
            });
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});


/* Edit form */
app.get('/edit', async (req, res) => {
   if (req.isAuthenticated()) {
    try {
      const id   = parseInt(req.query.id, 10);
      const book = (await db.query(
        'SELECT * FROM my_books WHERE id=$1 AND user_id=$2',
        [id, req.user.id]
      )).rows[0];
      if (!book) return res.status(404).send('Not found');
      book.end_date = new Date(book.end_date).toISOString().slice(0, 10);
      res.render('edit.ejs', { book });
    } catch (err) {
      console.error('Edit load failed:', err);
      res.status(500).send('Error loading book.');
    }
  }
  else {
    res.redirect("/");
  }

});

/* Edit save */
app.post('/edit', async (req, res) => {
  if (req.isAuthenticated()) {
    const { id, introduction, notes, rating, end_date } = req.body;
    try {
      await db.query(
        'UPDATE my_books SET introduction=$1, notes=$2, rating=$3, end_date=$4 WHERE id=$5 AND user_id=$6',
        [introduction, notes, rating, end_date, id, req.user.id]
      );
      res.redirect('/books');
    } catch (err) {
      console.error('Edit failed:', err);
      res.status(500).send('Update failed.');
    }
  }
  else {
      res.redirect("/");
   }
});

/* Delete */
app.post('/delete', async (req, res) => {
  if (req.isAuthenticated()) {
    try {
      await db.query(
        'DELETE FROM my_books WHERE id=$1 AND user_id=$2',
        [req.body.id, req.user.id]
      );
      res.redirect('/books');
    } catch (err) {
      console.error('Delete failed:', err);
      res.status(500).send('Delete failed.');
    }
  }
  else {
    res.redirect("/");
  }

});

/* Continue reading */
app.get('/continue', async (req, res) => {
  if (req.isAuthenticated())
    {
      try {
        const id   = parseInt(req.query.id, 10);
        const book = (await db.query(
          'SELECT * FROM my_books WHERE id=$1 AND user_id=$2',
          [id, req.user.id]
        )).rows[0];
        if (!book) return res.status(404).send('Not found');
        book.end_date = new Date(book.end_date).toISOString().slice(0, 10);
        res.render('continue.ejs', { book });
      } catch (err) {
        console.error('Continue failed:', err);
        res.status(500).send('Error loading book.');
      }
  }
  else
  {
    res.redirect("/");
  }

});

/* ───────────────────────────
   4. START SERVER
─────────────────────────── */



passport.use("local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        if (!storedHashedPassword) return cb(null, false);
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              return cb(null, user);
            } else {
              //Did not pass password check
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.use(
  "google",
  new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL ||
                 "https://book-notes-o5f0.onrender.com/auth/google/books",
    userProfileURL:"https://www.googleapis.com/oauth2/v3/userinfo",


  }, async (accessToken, refreshToken, profiler, cb) => {
    try {
      if (process.env.ALLOWED_GOOGLE_DOMAIN) {
        const domain = profiler.email.split('@')[1];
        if (domain !== process.env.ALLOWED_GOOGLE_DOMAIN) {
          return cb(null, false);
        }
      }

      const result = await db.query('SELECT * FROM users WHERE email = $1', [profiler.email]);
      if (result.rows.length === 0) {
        const newUser = await db.query('INSERT INTO users (email) VALUES ($1) RETURNING *', [profiler.email]);
        return cb(null, newUser.rows[0]);
      }
      return cb(null, result.rows[0]);
    } catch (err) {
      cb(err);
    }

  }) );

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});


/* ERROR HANDLER – catches everything
   and always sends a 500 JSON payload */
app.use((err, req, res, next) => {
  console.error("UNCAUGHT ROUTE ERROR:", err);
  if (res.headersSent) return next(err);
  if (process.env.NODE_ENV === "production") {
    res.status(500).send("Internal Server Error");
  } else {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
