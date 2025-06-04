# 📚 Book‑Notes — Personal Reading Tracker & Auth‑Enabled Library

➡️ **Live demo on Render:** [https://book-notes-o5f0.onrender.com](https://book-notes-o5f0.onrender.com)
*(free Render Web Service + Render PostgreSQL)*

Track everything you read, write notes, and rate books — now with **secure local auth (*bcrypt + Passport‑local*)** and **Google OAuth 2.0**.  Works out‑of‑the‑box on **localhost** (no Docker) and deploys in two clicks to **Render** with enforced HTTPS.

---

## ✨ Features

| Domain       | Details                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Accounts** | • Local sign‑up/login with hashed passwords  <br> • Google Login via OAuth 2.0  <br> • Optional domain whitelist via `ALLOWED_GOOGLE_DOMAIN`  <br> • Session powered by `express‑session`                            |
| **Books**    | • Add, edit, continue, delete  <br> • Scoped **per‑user** (*each user sees only their own books*)  <br> • Cover pulled from Open Library automatically |
| **Data**     | • PostgreSQL 15+  <br> • Auto‑creates `users` & `my_books` tables on startup  <br> • All SQL parameterised — safe from injection                       |
| **UI**       | • EJS + Bootstrap 5‑RTL templates (`home`, `login`, `register`, `books`, `add`, `edit`, `continue`)  <br> • Responsive & Hebrew‑friendly               |
| **Ops**      | • `/health` endpoint  <br> • Global error handler  <br> • Middleware that **forces HTTPS** on Render (returns 426 otherwise)                           |

---

## 🛠 Tech Stack

| Layer      | Tech                                                            |
| ---------- | --------------------------------------------------------------- |
| **Server** | Node 20.x, Express 5, Axios                                     |
| **Auth**   | Passport‑local, Passport‑Google‑OAuth2, bcrypt, express‑session |
| **DB**     | PostgreSQL 15, `pg` driver                                      |
| **Views**  | EJS, Bootstrap 5‑RTL                                            |
| **Dev**    | Nodemon, dotenv                                                 |
| **Deploy** | Render Web Service + Render PostgreSQL                          |

---

## 🚀 Quick Start (Local Dev)

```bash
# 1 Clone & enter
git clone https://github.com/neo050/Book-Notes.git
cd Book-Notes

# 2 Install\ npm install

# 3 Configure env – copy & edit\ ncp .env.example .env
#    (set `ALLOWED_GOOGLE_DOMAIN` if Google logins should come from one domain)

# 4 Init DB (example)
createdb books
psql -d books -f db/schema.sql

# 5 Run (auto‑reload)
PORT=3001 npm run dev

# 6 Open the app
http://localhost:3001
```

### .env example

```ini
# HTTP
PORT=3001
SESSION_SECRET=change‑me‑in‑prod

# OAuth (Google Cloud Console)
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# Optional: restrict Google sign-in to one domain
ALLOWED_GOOGLE_DOMAIN=

# Local PostgreSQL
DATABASE_URL=postgres://postgres:password@localhost:9977/books
```

*Render injects its own `DATABASE_URL` & `PORT`; just set `SESSION_SECRET`, `GOOGLE_CLIENT_*` and (optionally) `ALLOWED_GOOGLE_DOMAIN`.*

---

## 🗄 Database Schema (`db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  email     VARCHAR(100) UNIQUE NOT NULL,
  password  VARCHAR(100)        NOT NULL
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

## 📑 REST / Auth API

| Method | Endpoint             | Auth? | Purpose                 |
| ------ | -------------------- | ----- | ----------------------- |
| GET    | `/`                  | ✖     | Landing page            |
| GET    | `/login` `/register` | ✖     | Auth forms              |
| POST   | `/login`             | ✖     | Local login (Passport)  |
| POST   | `/register`          | ✖     | Local sign‑up           |
| GET    | `/auth/google`       | ✖     | Google OAuth consent    |
| GET    | `/auth/google/books` | ✖     | Google callback / login |
| GET    | `/books`             | ✔     | User’s book list        |
| POST   | `/add`               | ✔     | Add book                |
| GET    | `/edit?id=:id`       | ✔     | Edit form               |
| POST   | `/edit`              | ✔     | Save changes            |
| POST   | `/delete`            | ✔     | Delete book             |
| GET    | `/continue?id=:id`   | ✔     | Continue‑reading view   |
| GET    | `/health`            | ✖     | Render health probe     |

Auth‑protected routes redirect to **/login** when not authenticated.

---

## 🌐 Cover Helper Snippet

```html
<img src="https://covers.openlibrary.org/b/id/<%= cover_i %>-M.jpg"
     alt="Cover of <%= title %>" width="200" height="250" loading="lazy" />
```

Use `S`, `M`, `L` for different sizes.

---

## ☁️ Deploying to Render

1. **Create PostgreSQL** (free) → copy **Internal DB URL**.
2. **Add env vars**: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and optionally `ALLOWED_GOOGLE_DOMAIN`.
   You can leave local DB vars blank — Render injects its own.
3. **Create Web Service** → Build `npm install`, Start `node index.js`.
4. *Health Check Path* `/health`; force HTTPS toggle on.
5. Deploy → wait for “Detected open port” ✔.
6. Set the **Google OAuth “Authorized redirect URI”** in Google Cloud Console to:
   `https://book-notes-o5f0.onrender.com/auth/google/books`.

That’s it — login works with Google and local accounts.

---

## 🧾 NPM Scripts

```json
"scripts": {
  "dev":   "nodemon index.js",          // auto‑reload
  "start": "node index.js",             // production
  "db:init": "psql -d books -f db/schema.sql"
}
```

---

## 🤝 Acknowledgements

* **Open Library** — free covers & search API
* **Passport.js** & **bcrypt** — auth stack
* **Bootstrap RTL** via CDN
* **Render.com** — hobby hosting

---

## 📄 License

MIT — © 2025 Neoray
