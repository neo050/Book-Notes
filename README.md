# 📚 Book‑Notes — Personal Reading Tracker

➡️ **Live demo on Render:** [https://book-notes-o5f0.onrender.com](https://book-notes-o5f0.onrender.com)
*(free Render Web Service + Postgres)*

Minimal app for logging the non‑fiction books you read, jotting quick notes and ratings, and always seeing the cover pulled from the Open Library Covers API.  Works out‑of‑the‑box on **localhost** (no Docker) and deploys in two clicks to **Render** (SSL enforced).

---

## ✨ Features

* **CRUD interface** – add, edit, continue‑reading and delete books
* **PostgreSQL persistence** – `my_books` table auto‑created on first run
* **Sortable list** – by rating, recency or title *(coming soon)*
* **Cover images** pulled on‑the‑fly from Open Library
* **Server‑side rendering** – EJS + Bootstrap 5 (**RTL‑ready**)
* **REST JSON API** for each resource (future SPA ready)
* `/health` endpoint + global error handler (Render friendly)

## 🛠 Tech Stack

| Layer  | Tech                                   |
| ------ | -------------------------------------- |
| Server | **Node 20.x**, Express 5, Axios        |
| DB     | **PostgreSQL 15** (pg driver)          |
| Views  | EJS templates, Bootstrap 5‑RTL         |
| Dev    | Nodemon, dotenv                        |
| Deploy | Render Web Service + Render PostgreSQL |

---

## 🚀 Quick Start

```bash
# 1 Clone & enter
$ git clone https://github.com/neo050/Book-Notes.git
$ cd Book-Notes

# 2 Install
$ npm install

# 3 Configure env
$ cp .env.example .env         # edit if needed

# 4 Init DB (local example)
$ createdb books               # or use Docker / pgAdmin
$ psql -d books -f db/schema.sql

# 5 Run in dev mode
$ npm run dev                  # nodemon index.js

# 6 Open the app
👉 http://localhost:3001
```

### .env example

```
# HTTP server
PORT=3001

# Local PostgreSQL
DATABASE_URL=postgres://postgres:password@localhost:9977/books
```

*Render overwrites `DATABASE_URL` & `PORT` automatically.*

---

## 🗄 Database Schema (`db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS my_books (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(100)  NOT NULL,
    introduction VARCHAR(1000) NOT NULL,
    notes        VARCHAR(10000)NOT NULL,
    author_name  VARCHAR(100)  NOT NULL,
    rating       SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 10),
    end_date     DATE          NOT NULL,
    cover_i      INT           NOT NULL
);
```

Sample insert:

```sql
INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i)
VALUES ('Atomic Habits',
        'Evidence‑based handbook on building tiny habits.',
        'See README for full notes.',
        'James Clear',
        9,
        '2025‑05‑22',
        14589634);
```

---

## 📑 REST API

| Method | Endpoint     | Description     |
| ------ | ------------ | --------------- |
| GET    | `/books`     | List all books  |
| GET    | `/books/:id` | Single book     |
| POST   | `/books`     | Add new book    |
| PUT    | `/books/:id` | Update existing |
| DELETE | `/books/:id` | Delete          |

All EJS forms post to these endpoints; feel free to swap them with AJAX.

---

## 🌐 Cover Helper

```html
<img src="https://covers.openlibrary.org/b/id/<%= cover_i %>-M.jpg"
     alt="Cover of <%= title %>" width="200" height="250" loading="lazy" />
```

Replace **`M`** with **`S`** or **`L`** for other sizes. `cover_i` is returned by the Open Library Search API.

---

## ☁️ Deploying to Render (free tier)

1. **Create Postgres** → *New ▸ PostgreSQL* → copy **Internal Database URL**.
2. **Create Web Service** → connect this repo.
3. *Build:* `npm install`  *Start:* `node index.js`.
4. *Env Vars* → add `DATABASE_URL` (Render often auto‑injects).
5. *Health Check Path* → `/health`.
6. After “Detected open port ✔” your app is live at something like:
   `https://book-notes-o5f0.onrender.com`.

*✅ Tested 25 May 2025 – works on Render free tier (750 h/month), SSL enforced.*

---

## 🧾 NPM Scripts

```json
"scripts": {
  "dev":   "nodemon index.js",      // auto‑reload
  "start": "node index.js",         // production
  "db:init": "psql -d books -f db/schema.sql"
}
```

---

## 🤝 Acknowledgements

* **Open Library** – free book covers & search API
* **Bootstrap RTL** via CDN
* **Render.com** – simple hobby hosting

## 📄 License

MIT — © 2025 Neoray
