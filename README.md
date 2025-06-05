# 📚 Book‑Notes — Personal Reading Tracker + Secure Auth

➡️ **Live demo on Render:** [https://book-notes-o5f0.onrender.com](https://book-notes-o5f0.onrender.com) *(Render free‑tier Web Service + PostgreSQL)*

Store every non‑fiction book you read, add notes & ratings, and sign‑in with either **local credentials** or **Google OAuth 2.0**. The project runs instantly on **localhost** (no Docker) and deploys in two clicks to **Render**, where HTTPS is enforced automatically.

---

## ✨ Key Features

| Domain             | Highlights                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication** | • Local sign‑up/login (bcrypt + Passport‑local)  <br>• Google login (Passport‑Google‑OAuth2)  <br>• Optional domain allow‑list – `ALLOWED_GOOGLE_DOMAIN`                                                                                                                                                                                                   |
| **Security**       | • HTTPS redirect middleware  <br>• `express‑session` + **Secure / HttpOnly / SameSite=Lax** cookies  <br>• Session store in **PostgreSQL** (`connect‑pg‑simple`)  <br>• **Helmet** CSP incl. `archive.org` covers  <br>• **CSRF** protection (`csurf`)  <br>• **Rate‑limit** on `/login` (5 tries / 15 min)  <br>• Session rotation after login (fixation) |
| **Books**          | • Add, edit, continue, delete  <br>• Books are **scoped per‑user**  <br>• Cover fetched from Open Library                                                                                                                                                                                                                                                  |
| **Data**           | • PostgreSQL 15  <br>• Tables auto‑create on first run  <br>• All SQL parameterised                                                                                                                                                                                                                                                                        |
| **UI**             | • Server‑side EJS templates  <br>• Bootstrap 5‑RTL – mobile friendly                                                                                                                                                                                                                                                                                       |
| **Ops**            | • `/health` endpoint  <br>• Central error handler (prod vs. dev)                                                                                                                                                                                                                                                                                           |

---

## 🛠️ Tech Stack

| Layer         | Tech                                                 |
| ------------- | ---------------------------------------------------- |
| **Runtime**   | Node 20, Express 5                                   |
| **Auth**      | Passport‑local, Passport‑Google‑OAuth2, bcrypt       |
| **Security**  | Helmet, csurf, express‑rate‑limit, connect‑pg‑simple |
| **DB**        | PostgreSQL 15 + `pg` driver                          |
| **Views**     | EJS, Bootstrap 5‑RTL                                 |
| **Dev Tools** | Nodemon, dotenv                                      |
| **Deploy**    | Render Web Service + Render PostgreSQL               |

---

## 🚀 Quick Start (Local)

```bash
# 1 Clone
$ git clone https://github.com/neo050/Book-Notes.git
$ cd Book-Notes

# 2 Install deps
$ npm install

# 3 Environment
$ cp .env.example .env   # edit values

# 4 Create DB (example)
$ createdb books
$ psql -d books -f db/schema.sql   # optional – tables auto‑create

# 5 Run in dev mode (auto‑reload)
$ npm run dev

# 6 Open
👉 http://localhost:3001
```

> **Prerequisites:** Node 18+ and PostgreSQL 14+. Google OAuth requires a project & Client ID in Google Cloud Console.

\### `.env.example`

```ini
# Server
PORT=3001
SESSION_SECRET=change-me

# PostgreSQL (local)
DATABASE_URL=postgres://postgres:password@localhost:9977/books

# Google OAuth
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/books
# Restrict Google login (optional)
ALLOWED_GOOGLE_DOMAIN=
```

Render injects its own `PORT` & `DATABASE_URL`; keep those lines but you don’t need to fill them.

---

## 🗄️ Database Schema

```sql
CREATE TABLE IF NOT EXISTS users (
  id       SERIAL PRIMARY KEY,
  email    VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(100)         -- null when created via Google
);

CREATE TABLE IF NOT EXISTS my_books (
  id           SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(100)  NOT NULL,
  introduction VARCHAR(1000) NOT NULL,
  notes        VARCHAR(10000)NOT NULL,
  author_name  VARCHAR(100)  NOT NULL,
  rating       SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 10),
  end_date     DATE          NOT NULL,
  cover_i      INT           NOT NULL
);
```

---

## 📑 Endpoint Overview

| Verb | Path                       | Auth | Purpose         |
| ---- | -------------------------- | ---- | --------------- |
| GET  | `/`                        | –    | Landing         |
| GET  | `/login` `/register`       | –    | Forms           |
| POST | `/login`                   | –    | Local login     |
| POST | `/register`                | –    | Local sign‑up   |
| GET  | `/auth/google`             | –    | Google consent  |
| GET  | `/auth/google/books`       | –    | Google callback |
| GET  | `/books`                   | ✓    | List user books |
| GET  | `/add` `/edit` `/continue` | ✓    | Forms           |
| POST | `/add` `/edit` `/delete`   | ✓    | Mutations       |
| GET  | `/health`                  | –    | Render probe    |

Unauthenticated requests to ✓ routes redirect to **/login**.

---

## 🔐 Security Highlights

* **HTTPS enforcement** on Render (301 to HTTPS, else 426 locally).
* **Secure/HttpOnly/SameSite=Lax cookies** (`secure:'auto'`).
* **Session store in PostgreSQL** – survives restarts, prevents memory leaks.
* **Helmet** with custom CSP (`archive.org` & `covers.openlibrary.org` allowed for images).
* **CSRF protection** via `csurf` (tokens injected into every form).
* **Rate‑limit** / brute‑force protection – 5 login attempts / 15 min.
* **Session fixation** mitigation – regenerate session ID on every login.
* **Parameterized SQL** only (no string concatenation).

---

## ☁️ Deploy to Render

1. **Create a Postgres DB** → copy its **Internal DB URL**.
2. **Create a Web Service** from this repo.
   \* Build Cmd:\* `npm install`   *Start Cmd:* `node index.js`
3. In *Environment* add `SESSION_SECRET`, Google OAuth vars, and (optionally) `ALLOWED_GOOGLE_DOMAIN`.
4. *Health Check Path:* `/health`; enable **Force HTTPS**.
5. In Google Cloud Console add the Render URL to **Authorized redirect URIs**.

Live in \~30 sec 🎉

---

## 🧾 Scripts

```json
"scripts": {
  "dev":   "nodemon index.js",
  "start": "node index.js",
  "db:init": "psql -d books -f db/schema.sql"
}
```

---

## 🤝 Acknowledgements

* Open Library – cover & search API
* Passport + bcrypt – auth stack
* Helmet, csurf, express‑rate‑limit – security middleware
* Bootstrap RTL – layout
* Render.com – free hosting

---

## 📄 License

MIT — © 2025 Neoray
