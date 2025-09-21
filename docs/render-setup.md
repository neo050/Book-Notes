Book Notes — Render Production Setup (Neon + Upstash)

Overview
- Goal: run the app on Render with managed Postgres (Neon) + managed Redis (Upstash), including pgvector for RAG.
- Result: the app boots reliably, `/api/search` works (hybrid vector + FTS), and Redis backs caching.

Why Neon + Upstash
- Managed, reliable, low‑friction. No containers or disks to babysit on Render.
- Neon supports `pgvector` via `CREATE EXTENSION vector;`.
- Upstash provides a simple `rediss://` URL with TLS.

1) Create Postgres (Neon) with pgvector
- Create a Neon project and DB.
- Get the connection string; ensure it has `?sslmode=require` (Neon defaults to SSL).
- Enable pgvector:
  - Use Neon SQL editor (or psql) and run:
    CREATE EXTENSION IF NOT EXISTS vector;
  - That’s it. The app’s `ensureSchema()` will create tables/indexes on first boot.

2) Create Redis (Upstash)
- Create a new Redis database in Upstash.
- Copy the public connection URL (starts with `rediss://`).

3) Configure the Render Web Service
- Service: Web → Node.
- Build command:
  npm ci && npm run build:client || true
- Start command:
  node index.js
- Add Environment Variables (from your providers):
  - SESSION_SECRET: a strong random string
  - FIREBASE_SA_JSON: Base64 of your Firebase service account JSON
  - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  - CALL_BACK_URL: https://<your-service>.onrender.com/auth/google/books
  - DATABASE_URL: paste from Neon (e.g. postgresql://...:5432/db?sslmode=require)
  - REDIS_URL: paste from Upstash (rediss://:<password>@<host>:<port>)
  - OPENAI_API_KEY: your key
  - EMBED_MODEL: text-embedding-3-small
  - EMBED_DIM: 1536
  - USE_RERANK: false (or true if you want LLM re-ranking)
  - RERANK_TIMEOUT_MS: 6000
  - RAG_MIN_FTS_RATIO: 0.4 (DB short-circuit only if >=40% FTS hits)
  - METRICS_TOKEN: choose a random token to protect /metrics

Windows tip (PowerShell) to Base64 your Firebase JSON
  $bytes = [System.IO.File]::ReadAllBytes("project-id-firebase-adminsdk.json")
  $b64 = [System.Convert]::ToBase64String($bytes)
  $b64  # copy this into FIREBASE_SA_JSON

macOS/Linux tip
  base64 -w0 project-id-firebase-adminsdk.json

4) Update Google OAuth redirect
- In Google Cloud Console → Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs:
  https://<your-service>.onrender.com/auth/google/books
- Ensure this exactly matches `CALL_BACK_URL`.

5) Deploy and verify
- Hit /health → expect 200.
- Hit /api/search?q=tolkien&limit=5 while logged in.
  - If you see logs like "[RAG] postgres connect failed" → check DATABASE_URL and network.
  - If you get vector/tsv errors → ensure the Neon DB had `CREATE EXTENSION vector;` run.
- Redis errors won’t crash the app; they’ll show as warnings and search will still work, just without cache.

Notes
- The app auto-creates schema and indexes on boot (`services/ragSearch.js::ensureSchema`).
- For self-hosting DB/Redis on Render instead, use docker images:
  - Postgres: pgvector/pgvector:pg16 (mount a disk at /var/lib/postgresql/data)
  - Redis: redis:7.4-alpine (mount a disk at /data)
