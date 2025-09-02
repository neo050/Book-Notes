# 📚 Book‑Notes — Personal Reading Tracker + AI‑powered RAG Live demo book-notes-o5f0.onrender.com

Keep track of everything you read, write notes & ratings, and—new in **v2**—ask questions about your own library through a Retrieval‑Augmented‑Generation (RAG) layer powered by **LangChain + OpenAI**.

The app stores all data in **Cloud Firestore** (server SDK), runs instantly on localhost (with the Firestore Emulator), and deploys easily to **Render**. The frontend is a modern **React (Vite)** SPA that talks to a hardened **Express 5** JSON API. Docker configs are included for dev/prod.

---

## ✨ Key Features

| Domain             | Highlights                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication** | • Local sign‑up / login (bcrypt + Passport‑local)  <br>• Google OAuth 2.0 (Passport‑Google)  <br>• Optional domain allow‑list: `ALLOWED_GOOGLE_DOMAIN`                                                                                                                                                                                        |
| **Security**       | • HTTPS redirect middleware  <br>• **Secure / HttpOnly / SameSite=Lax** session cookies stored in **Firestore** (custom session store)  <br>• **Helmet** CSP incl. Open Library covers  <br>• **CSRF** protection (`csurf`); SPA fetches `/api/csrf-token` and sends `x-csrf-token`  <br>• **Rate‑limit** on `/login` (5 / 15 min)  <br>• Session rotation after login (fixation) |
| **Books**          | • Add, edit, continue, delete  <br>• Books are **scoped per‑user**  <br>• Cover fetched from Open Library                                                                                                                                                                                                                                     |
| **AI / RAG**       | • Vector store based on **PGVector** (Postgres) *or* **Firestore** (embeddings as arrays)  <br>• Embeddings via **OpenAI `text‑embedding‑3‑small`**  <br>• Chunking with LangChain `RecursiveCharacterTextSplitter`  <br>• Ask free‑form questions about your own notes (beta)                                                                         |
| **Data**           | • Cloud Firestore in two modes:  <br>  • **Production** – real GCP project  <br>  • **Local dev** – Firestore Emulator (no internet)                                                                                                                                                                                                          |
| **Frontend**       | • **React 18 (Vite)** SPA  <br>• Client‑side routing  <br>• Bootstrap 5‑RTL  <br>• Delete confirmations with in‑app modal (no browser alerts)                                                                                                                                                                                                     |
| **Backend**        | • **Express 5** JSON API  <br>• SPA fallback for non‑`/api/*` routes  <br>• Health probe `/health`                                                                                                                                                                                                                                                   |
| **Tests**          | • Unit + E2E (Node test runner + Supertest)  <br>• In‑memory Firestore for tests  <br>• Optional load test profile (Artillery)                                                                                                                                                                                                                     |

---

## 🛠️ Tech Stack

| Layer         | Tech                                                     |
| ------------- | -------------------------------------------------------- |
| **Runtime**   | Node 20, Express 5                                       |
| **Auth**      | Passport‑local, Passport‑Google‑OAuth2, bcrypt           |
| **Security**  | Helmet, csurf, express‑rate‑limit                         |
| **Data**      | Cloud Firestore (server SDK) + Firestore Emulator        |
| **AI / RAG**  | LangChain, OpenAI Embeddings, PGVector (optional)        |
| **Frontend**  | React 18 + Vite, React‑Router, Bootstrap 5‑RTL           |
| **Dev Tools** | Nodemon, dotenv, Firebase CLI, Node test runner, Supertest |
| **Ops**       | Dockerfile + docker‑compose (dev/prod), Health checks    |

---

## 🚀 Quick Start (Local)

```bash
# 1 Clone
git clone https://github.com/neo050/Book-Notes.git
cd Book-Notes

# 2 Install deps
npm install
cd client && npm install && cd ..

# 3 Environment (copy + edit)
cp .env.example .env

# 4 Run API (port 3000)
npm run dev

# 5 Start Firestore Emulator (optional, new terminal)
# If you use Firebase CLI
# firebase emulators:start --only firestore --project book-notes-dev

# 6 Run API (points to emulator if FIRESTORE_EMULATOR_HOST is set)
npm run dev

# 7 Run React dev server (port 5173, proxied to API)
cd client && npm run dev

# 8 Open React app
👉 http://localhost:5173
```

> Prerequisites: Node 18+, Firebase CLI (for emulator), Google OAuth Client ID/Secret. For dev, set `CALL_BACK_URL=http://localhost:3000/auth/google/books`.

---

## 🐳 Docker

Builds React client and serves it via Express.

```bash
# Production‑like locally (uses .env.production)
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# App is on http://localhost:3000
```

Dev compose (optional): use `docker-compose.yml` and your `.env`. If you run a local Firestore emulator on the host, set `FIRESTORE_EMULATOR_HOST=host.docker.internal:9080` so the container can reach it.

---

## 🔧 Configuration

Minimal variables (dev/prod):

```ini
SESSION_SECRET=change-me
USE_REACT=true

# Google OAuth
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
CALL_BACK_URL=http://localhost:3000/auth/google/books
ALLOWED_GOOGLE_DOMAIN=

# Firestore (choose one)
# 1) Cloud: provide FIREBASE_SA_JSON (Base64 of service account JSON)
FIREBASE_SA_JSON=...base64...
# 2) Emulator: set FIRESTORE_EMULATOR_HOST (e.g. localhost:9080)
# FIRESTORE_EMULATOR_HOST=localhost:9080

# RAG (optional)
OPENAI_API_KEY=sk-...
```

In tests we use an in‑memory Firestore automatically (`NODE_ENV=test`).

---

## 📑 Endpoint Overview

| Verb | Path                 | Auth | Purpose                         |
| ---- | -------------------- | ---- | ------------------------------- |
| GET  | `/health`            | –    | Liveness probe                  |
| GET  | `/api/csrf-token`    | –    | Get CSRF token for SPA          |
| GET  | `/api/me`            | –    | Session info `{authenticated}`  |
| GET  | `/api/books`         | ✓    | List user’s books               |
| GET  | `/api/books/:id`     | ✓    | Get a book                      |
| POST | `/api/books`         | ✓    | Create (JSON + CSRF)            |
| PUT  | `/api/books/:id`     | ✓    | Update (JSON + CSRF)            |
| DEL  | `/api/books/:id`     | ✓    | Delete (JSON + CSRF)            |
| GET  | `/auth/google`       | –    | Google consent                  |
| GET  | `/auth/google/books` | –    | Google callback                 |
| POST | `/ask`               | ✓    | RAG question (beta)             |

SPA routes (React) are served for any non‑`/api/*` path when `client/dist` exists.

---

## 🔐 Security Highlights

* **HTTPS enforcement** (when behind proxy)
* **Secure/HttpOnly/SameSite=Lax cookies** (`secure:'auto'`)
* **Session store in Firestore** (custom store), memory store in tests
* **Helmet** CSP with Open Library cover domains
* **CSRF protection** (`csurf`); SPA fetches `/api/csrf-token` and sends `x-csrf-token`
* **Rate‑limit** on `/login` (5 attempts / 15 min)
* **Session fixation** mitigation via `req.session.regenerate()`

---

## 🧪 Tests

```bash
# Run all unit + E2E tests (Node test runner)
npm test

# Load test (Artillery) — use with care
npx artillery run load/artillery.yml
```

Highlights:
– In‑memory Firestore in tests (`NODE_ENV=test`) for fast, hermetic runs.
– E2E (`test/api.e2e.test.js`) covers login, CSRF, full CRUD.
– Optional load profile `load/artillery.yml` (warm‑up, ramp, 10k spike).

---

## ☁️ Deploy

Any Node host or container platform works. For Docker:

1. Build client + server with the provided `Dockerfile`.
2. Use `docker-compose.prod.yml` and a `.env.production` containing production secrets.
3. Set Google OAuth **Authorized redirect URI** to your domain, e.g. `https://your-domain.com/auth/google/books`.

---

## 🧾 Scripts

```json
"scripts": {
  "dev":   "cross-env FIRESTORE_EMULATOR_HOST=127.0.0.1:9080 GCLOUD_PROJECT=book-notes-dev nodemon index.js",
  "start": "node index.js",
  "test":  "node --test --experimental-test-module-mocks"
}
```

---

## 🤝 Acknowledgements

* Open Library – cover & search API
* React, Vite, React Router – frontend stack
* Passport + bcrypt – auth stack
* Helmet, csurf, express‑rate‑limit – security middleware

---

## 📄 License

MIT — © 2025 Neoray
