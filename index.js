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

import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import env from "dotenv";
import GoogleStrategy from "passport-google-oauth2"
import pgSession from 'connect-pg-simple';
/* ───────────────────────────
   1. APP & STATIC FILES
─────────────────────────── */
const app  = express();
const PORT = process.env.PORT || 3000;
const saltRounds = 10;
env.config();

app.use(
  session({
    store: new (pgSession(session))({ pool: db }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));


app.use(passport.initialize());
app.use(passport.session());

/* ───────────────────────────────
   DEBUG LOGGER – prints every hit
──────────────────────────────── */
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

/* ───────────────────────────────
   HTTPS ENFORCEMENT on Render
──────────────────────────────── */
const onRender = process.env.DATABASE_URL?.includes('render.com');
app.use((req, res, next) => {
  // if on Render and not HTTPS, require upgrade
  if (onRender && req.headers['x-forwarded-proto'] !== 'https') {
    return res.status(426).send('Upgrade Required');
  }
  next();
});

/* ERROR HANDLER – catches everything
   and always sends a 500 JSON payload */
app.use((err, req, res, next) => {
  console.error('UNCAUGHT ROUTE ERROR:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: String(err) });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));

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

await db.query(`
  CREATE TABLE IF NOT EXISTS my_books (
    id            SERIAL PRIMARY KEY,
    title         VARCHAR(100)  NOT NULL,
    introduction  VARCHAR(1000) NOT NULL,
    notes         VARCHAR(10000) NOT NULL,
    author_name   VARCHAR(100)  NOT NULL,
    rating        SMALLINT      NOT NULL,
    end_date      DATE          NOT NULL,
    cover_i       INT           NOT NULL
  );
`);

await db.query(`
  CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
 
  email        VARCHAR(100)  NOT NULL,

  password  VARCHAR(100)  NOT NULL
 
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

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/books",
    failureRedirect: "/login",
  })
);



app.post("/register", async (req, res) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      req.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect("/books");
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
      const book = (await db.query('SELECT * FROM my_books WHERE id=$1', [id])).rows[0];
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
        'UPDATE my_books SET introduction=$1, notes=$2, rating=$3, end_date=$4 WHERE id=$5',
        [introduction, notes, rating, end_date, id]
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
      await db.query('DELETE FROM my_books WHERE id=$1', [req.body.id]);
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
        const book = (await db.query('SELECT * FROM my_books WHERE id=$1', [id])).rows[0];
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
    callbackURL:"https://book-notes-o5f0.onrender.com/auth/google/books",
    userProfileURL:"https://www.googleapis.com/oauth2/v3/userinfo",


  }, async(accessToken,refreshToken,profiler,cb)=>
  {
    console.log(profiler);
    try
    {
        const result = await db.query("SELECT * FROM users WHERE email = $1", [profiler.email]);
        if(result.rows.length === 0)
        {
          const newUser = await db.query("INSERT INTO users (email, password) VALUES ($1,$2)",[profiler.email,"google"]);
          cb(null,newUser.rows[0]);
          
        }
        else
        {
          cb(null,result.rows[0]);
        }
    }
    catch(err)
    {
      cb(err);
    }

  }) );

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
