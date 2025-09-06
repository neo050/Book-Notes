# Architecture Diagrams

## System Architecture
```mermaid
graph LR
  U[User Browser]

  subgraph Frontend
    R[React SPA (Vite build)]
    V[EJS Views (SSR fallback)]
  end

  subgraph Server[Express 5 App]
    S[Express API + Static]
    M[Security Middleware<br/>Helmet, Rate Limit]
    C[CSRF (csurf)]
    SS[Sessions<br/>express-session + Firestore store]
    PL[Passport Local + bcrypt]
    PG[Passport Google OAuth2]
    B[Books CRUD APIs]
    OLH[Open Library Helper<br/>(/api/ol-search)]
    RAG[/api/search (RAG)]
    MET[/metrics]
    HL[/health]
    LOG[Structured Logger (JSON)]
  end

  subgraph Data_Stores[Data Stores]
    FS[(Firestore<br/>users, books, sessions)]
    PGDB[(Postgres + pgvector<br/>books table + FTS)]
    RD[(Redis Cache)]
  end

  subgraph External_Services[External Services]
    OL[[Open Library API]]
    OA[[OpenAI<br/>embeddings + rerank]]
    GOOG[[Google OAuth]]
  end

  subgraph Observability
    PR[(Prometheus)]
    VM[(VictoriaMetrics)]
    GF[(Grafana)]
  end

  subgraph Deployment
    DK[(Docker/Compose,<br/>Distroless runtime)]
    K8[(Kubernetes Service +<br/>ServiceMonitor)]
  end

  %% Client ↔ Server
  U -->|HTML/JS| R
  U -->|HTML| V
  R -->|JSON API| S
  V -->|Form/GET| S
  S -->|serve client/dist| R

  %% Middleware / Security / Sessions
  S --> M --> C
  S --> SS --> FS
  S --> PL
  S --> PG --> GOOG

  %% Books CRUD + helper search
  B --> FS
  OLH --> OL

  %% RAG search data flow (high-level)
  RAG --> RD
  RAG --> PGDB
  RAG --> OL
  RAG --> OA

  %% Metrics / Health / Logs
  S --> MET
  PR -->|scrape /metrics| S
  PR -->|remote_write| VM
  GF -->|query| PR
  S --> HL
  S --> LOG

  %% Deployment integrations
  DK --> S
  K8 --> PR
```

## RAG / Search Flow
```mermaid
sequenceDiagram
  autonumber
  participant U as User (SPA)
  participant A as Express /api/search
  participant R as Redis
  participant P as Postgres+pgvector (FTS)
  participant O as OpenAI (embed/rerank)
  participant L as Open Library

  U->>A: GET /api/search?q=...
  A->>R: GET final:result cache
  alt Cache hit
    R-->>A: cached payload
    A-->>U: 200 results
  else Cache miss
    A->>P: Hybrid search (vector + FTS) on normalized query
    alt Enough results (DB short‑circuit)
      opt Optional rerank (if enabled)
        A->>O: Rerank top K (timeout protected)
      end
      A->>R: SET final:result cache (TTL)
      A-->>U: 200 results
    else Not enough
      A->>O: Expand query (hints, translate if needed)
      par Fetch Open Library variants
        A->>L: Search multiple variants (title:, author:, keywords, lang)
        L-->>A: Candidate docs
      and Enrich + upsert
        A->>L: Fetch work details
        A->>O: Embed new/changed rows (batch)
        A->>P: Upsert rows (metadata + vector); trigger updates FTS
      end
      A->>P: Hybrid search (vector + FTS) with bonuses
      opt Optional rerank (if enabled)
        A->>O: Rerank top K (timeout protected)
      end
      A->>R: SET final:result cache (TTL)
      A-->>U: 200 results
    end
  end

  Note over A,R: Also caches OL responses, query embeddings, rerank order
```

