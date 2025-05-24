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

/* ───────────────────────────
   1. APP & STATIC FILES
─────────────────────────── */
const app  = express();
const PORT = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));

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

/* ───────────────────────────
   3. ROUTES
─────────────────────────── */

/* Health check (use /health on Render) */
app.get('/health', (_req, res) => res.sendStatus(200));

/* Home — list books */
app.get('/', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM my_books ORDER BY id DESC');
    const books  = result.rows.map(b => ({
      ...b,
      end_date: new Date(b.end_date).toISOString().slice(0, 10)
    }));
    res.render('index.ejs', { books });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).send('Database error.');
  }
});

/* Add book form */
app.get('/add', (_req, res) => res.render('add.ejs'));

/* Add book (POST) */
app.post('/add', async (req, res) => {
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
      'INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [book_name, introduction, notes, author_name, rating, end_date, cover]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Add book failed:', err);
    res.status(500).send('Failed to add book.');
  }
});

/* Edit form */
app.get('/edit', async (req, res) => {
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
});

/* Edit save */
app.post('/edit', async (req, res) => {
  const { id, introduction, notes, rating, end_date } = req.body;
  try {
    await db.query(
      'UPDATE my_books SET introduction=$1, notes=$2, rating=$3, end_date=$4 WHERE id=$5',
      [introduction, notes, rating, end_date, id]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Edit failed:', err);
    res.status(500).send('Update failed.');
  }
});

/* Delete */
app.post('/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM my_books WHERE id=$1', [req.body.id]);
    res.redirect('/');
  } catch (err) {
    console.error('Delete failed:', err);
    res.status(500).send('Delete failed.');
  }
});

/* Continue reading */
app.get('/continue', async (req, res) => {
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
});

/* ───────────────────────────
   4. START SERVER
─────────────────────────── */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
