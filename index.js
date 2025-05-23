import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import pg from "pg";
import axios from "axios";

const app = express();
const PORT = process.env.PORT || 3001;

/* ──────────────────────────────────────────────────
   1.  MIDDLEWARE & STATIC FILES
─────────────────────────────────────────────────── */
app.use(bodyParser.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use("/css", express.static(path.join(__dirname, "node_modules/bootstrap/dist/css")));
app.use("/js",  express.static(path.join(__dirname, "node_modules/bootstrap/dist/js")));

/* ──────────────────────────────────────────────────
   2. DATABASE
─────────────────────────────────────────────────── */
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }          // Render’s external URL needs SSL
});

await db.connect();

// Ensure table exists on first deploy
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

/* ──────────────────────────────────────────────────
   3. ROUTES
─────────────────────────────────────────────────── */

// Health check for Render
app.get("/health", (_req, res) => res.sendStatus(200));

app.get("/", async (_req, res) => {
  try {
    const books = (await db.query("SELECT * FROM my_books ORDER BY id DESC")).rows;
    books.forEach(b => (b.end_date = new Date(b.end_date).toISOString().slice(0, 10)));
    res.render("index.ejs", { books });
  } catch (err) {
    console.error(err);
    res.status(500).send("Database error");
  }
});

app.get("/add", (_req, res) => res.render("add.ejs"));

app.post("/add", async (req, res) => {
  const { author_name, book_name, rating, introduction, notes, end_date } = req.body;
  if (!author_name || !book_name || !rating || !introduction || !notes || !end_date) {
    return res.status(400).send("Missing fields");
  }

  try {
    const { data } = await axios.get("https://openlibrary.org/search.json", {
      params: { title: book_name, author: author_name, limit: 1, fields: "title,cover_i,author_name" },
      timeout: 8000
    });

    const cover = data.docs?.[0]?.cover_i ?? 0;

    await db.query(
      "INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [book_name, introduction, notes, author_name, rating, end_date, cover]
    );
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to add book");
  }
});

app.get("/edit", async (req, res) => {
  const id = parseInt(req.query.id, 10);
  try {
    const book = (await db.query("SELECT * FROM my_books WHERE id=$1", [id])).rows[0];
    if (!book) return res.status(404).send("Not found");
    book.end_date = new Date(book.end_date).toISOString().slice(0, 10);
    res.render("edit.ejs", { book });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading book");
  }
});

app.post("/edit", async (req, res) => {
  const { id, introduction, notes, rating, end_date } = req.body;
  try {
    await db.query(
      "UPDATE my_books SET introduction=$1, notes=$2, rating=$3, end_date=$4 WHERE id=$5",
      [introduction, notes, rating, end_date, id]
    );
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Update failed");
  }
});

app.post("/delete", async (req, res) => {
  try {
    await db.query("DELETE FROM my_books WHERE id=$1", [req.body.id]);
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Delete failed");
  }
});

app.get("/continue", async (req, res) => {
  const id = parseInt(req.query.id, 10);
  try {
    const book = (await db.query("SELECT * FROM my_books WHERE id=$1", [id])).rows[0];
    if (!book) return res.status(404).send("Not found");
    book.end_date = new Date(book.end_date).toISOString().slice(0, 10);
    res.render("continue.ejs", { book });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading book");
  }
});

/* ──────────────────────────────────────────────────
   4. START SERVER
─────────────────────────────────────────────────── */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
