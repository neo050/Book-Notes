# 📚 Book‑Notes — Personal Reading Tracker + AI‑powered RAG

➡️ **Live demo on Render:** [https://book-notes-o5f0.onrender.com](https://book-notes-o5f0.onrender.com)

Keep track of everything you read, write notes & ratings, and—new in **v2**—ask questions about your own library through a Retrieval‑Augmented‑Generation (RAG) layer powered by **LangChain + OpenAI**.

The app now stores all data in **Cloud Firestore** (server SDK) instead of PostgreSQL, runs instantly on localhost (with the Firestore Emulator) and deploys in one click to **Render** (Firestore “production” project).

---

## ✨ Key Features

| Domain             | Highlights                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication** | • Local sign‑up / login (bcrypt + Passport‑local)  <br>• Google OAuth 2.0 (Passport‑Google)  <br>• Optional domain allow‑list: `ALLOWED_GOOGLE_DOMAIN`                                                                                                                                                                                        |
| **Security**       | • HTTPS redirect middleware  <br>• **Secure / HttpOnly / SameSite=Lax** session cookies stored in **Firestore** (`connect‑session‑firestore`)  <br>• **Helmet** CSP incl. `archive.org` cover images  <br>• **CSRF** protection (`csurf`)  <br>• **Rate‑limit** on `/login` (5 tries / 15 min)  <br>• Session rotation after login (fixation) |
| **Books**          | • Add, edit, continue, delete  <br>• Books are **scoped per‑user**  <br>• Cover fetched from Open Library                                                                                                                                                                                                                                     |
| **AI / RAG**       | • Vector store based on **PGVector** (Postgres) *or* **Firestore** (embeddings stored as arrays)  <br>• Embeddings via **OpenAI `text‑embedding‑3‑small`**  <br>• Chunking with LangChain `RecursiveCharacterTextSplitter`  <br>• Ask free‑form questions about your own notes (beta)                                                         |
| **Data**           | • Cloud Firestore in two modes:  <br>  • **Production** – real GCP project  <br>  • **Local dev** – Firestore Emulator (no internet)                                                                                                                                                                                                          |
| **UI**             | • Server‑side EJS templates  <br>• Bootstrap 5‑RTL – mobile first                                                                                                                                                                                                                                                                             |
| **Ops**            | • `/health` endpoint  <br>• Central error handler (prod vs. dev)                                                                                                                                                                                                                                                                              |

---

## 🛠️ Tech Stack

| Layer         | Tech                                                         |
| ------------- | ------------------------------------------------------------ |
| **Runtime**   | Node 20, Express 5                                           |
| **Auth**      | Passport‑local, Passport‑Google, bcrypt                      |
| **Security**  | Helmet, csurf, express‑rate‑limit, connect‑session‑firestore |
| **DB**        | Cloud Firestore (server SDK) + Firestore Emulator            |
| **AI / RAG**  | LangChain, OpenAI Embeddings, PGVector (optional)            |
| **Views**     | EJS, Bootstrap 5‑RTL                                         |
| **Dev Tools** | Nodemon, dotenv, Firebase CLI                                |
| **Deploy**    | Render (Web Service) + Firebase project                      |

---

## 🚀 Quick Start (Local)

```bash
# 1 Clone
$ git clone https://github.com/neo050/Book-Notes.git
$ cd Book-Notes

# 2 Install deps
$ npm install

# 3 Environment
$ cp .env.example .env           # edit values (OpenAI key, Google key, etc.)

# 4 Start Firestore Emulator (new terminal)
$ npm run dev:emu                # wraps: firebase emulators:start --only firestore

# 5 Run app (second terminal)
$ npm run dev:api                # nodemon + env pointing at emulator

# 6 Open
👉 http://localhost:3000
```

> **Prerequisites:** Node 18+, Firebase CLI ≥ 14, and an OpenAI API key if you want RAG locally.

\### `.env.example`

```ini
# --------------------------------------------------------------------
# Server
PORT=3000
SESSION_SECRET=change‑me‑please

# --------------------------------------------------------------------
# Firestore (prod)
GOOGLE_APPLICATION_CREDENTIALS=/full/path/serviceAccount.json
# Firestore (local/dev) — automatically set by npm run dev
FIRESTORE_EMULATOR_HOST=127.0.0.1:9080

# --------------------------------------------------------------------
# Google OAuth
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
CALL_BACK_URL=http://localhost:3000/auth/google/books
ALLOWED_GOOGLE_DOMAIN=

# --------------------------------------------------------------------
# OpenAI – for RAG features
OPENAI_API_KEY=sk‑...
```

---

## 🔀 Running with the Firestore Emulator

```bash
# one‑liner that runs both emulator and API in parallel
$ npm run dev           # `npm-run-all -p dev:emu dev:api`
```

The app auto‑detects the emulator via `FIRESTORE_EMULATOR_HOST`. No data ever leaves your machine.

---

## ☁️ Deploy to Render

1. **Add your Firebase service‑account JSON** as an environment variable:
   `FIREBASE_SA_JSON = $(base64 < serviceAccount.json)`
2. Set `GOOGLE_APPLICATION_CREDENTIALS=ignored.json` (any non‑empty value to disable emulator).
3. Add `SESSION_SECRET`, `OPENAI_API_KEY`, Google OAuth vars, etc.
4. Build Cmd: `npm install`   Start Cmd: `node index.js`
5. Health Check: `/health` (+ enable **Force HTTPS**).

Render connects to the same Firestore project your service‑account belongs to.

---

## 🧠 RAG Internals (beta)

```
┌─────────────┐              ┌──────────────────┐
│  Book note  │──TXT────────▶│ LangChain splitter│
└─────────────┘  chunks      └──────────────────┘
        │                                 │
        ▼                                 ▼
┌──────────────────┐           ┌────────────────────┐
│ OpenAI Embedding │  vectors  │   Vector store     │
└──────────────────┘──────────▶│  (pgvector / fs)   │
                                └────────────────────┘
```

* Each note is chunked (\~1 kB / 200 overlap) and embedded.
* Embeddings + metadata (`book_id`, `chunk_idx`) are upserted.
* PGVector is used in production (Render Postgres). For full‑serverless you can switch to an **array field in Firestore**; a helper wrapper is provided in `services/rag/storeFirestore.js`.
* The `/ask` route performs similarity search + LLM answer (streamed).

---

## 🤝 Acknowledgements

* **Open Library** – cover API & search
* **OpenAI** – embeddings & LLMs
* **LangChain** – RAG toolkit
* **Firebase** – Firestore + Emulator
* **Render.com** – free hosting

---

## 📄 License

MIT — © 2025 Neoray

> **Note on data stores:** RAG embeddings & search are persisted in **PostgreSQL + pgvector**, while the main application data (users & books) continue to live in **Firestore** – giving the project a clear two‑database architecture optimised for each workload.
