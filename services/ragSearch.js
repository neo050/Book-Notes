import axios from 'axios';
import Redis from 'ioredis';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
const { toSql, registerType } = pgvector;
import crypto from 'node:crypto';
import pLimit from 'p-limit';
import { z, ZodError } from 'zod';
import { remove as removeDiacritics } from 'diacritics';
import OpenAI from 'openai';
import { ragRequests, ragPhaseDuration, ragCacheHits, ragCacheMisses, ragAnalyzeRuns, ragDbShortcircuitHits, ragFinalResultCacheHits, ragEmbedSkipped, ragEmbedBatched, ragRerankTimeouts } from '../utils/metrics.js';

const EMBED_MODEL = process.env.EMBED_MODEL || 'text-embedding-3-small';
const EMBED_DIM   = Number(process.env.EMBED_DIM || 1536);

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, {
  // Upstash requires TLS (use rediss://). Add tls automatically when scheme is rediss
  tls: (process.env.REDIS_URL || '').startsWith('rediss://') ? {} : undefined,
  // Reduce noisy retries; fail fast and let app continue without cache
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 500, 2000),
}) : null;
// Avoid process crashes when Redis is unreachable or misconfigured
if (redis) {
  try {
    redis.on('error', (err) => {
      try { console.warn('[RAG] redis error:', err?.message || String(err)); } catch {}
    });
  } catch {}
}
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// teach pg about 'vector' once per pool
let PGVECTOR_TYPES_READY = false;
async function ensurePgvectorTypes() {
  if (!pool || PGVECTOR_TYPES_READY) return;
  try {
    await registerType(pool);
    PGVECTOR_TYPES_READY = true;
  } catch {
    // ignore; we will retry on next call
  }
}

async function safeRedisGet(key) {
  if (!redis) return null;
  try { return await redis.get(key); } catch { return null; }
}
async function safeRedisSet(key, val, ttlSec) {
  if (!redis) return;
  try { await redis.set(key, val, 'EX', ttlSec); } catch {}
}

async function cachedJson(key, ttlSec, fn) {
  if (redis) {
    const hit = await safeRedisGet(key);
    if (hit) {
      if (key.includes('openlibrary.org/search.json')) ragCacheHits.labels('ol_search').inc();
      else if (key.includes('/works/')) ragCacheHits.labels('work').inc();
      return JSON.parse(hit);
    }
    const val = await fn();
    await safeRedisSet(key, JSON.stringify(val), ttlSec);
    if (key.includes('openlibrary.org/search.json')) ragCacheMisses.labels('ol_search').inc();
    else if (key.includes('/works/')) ragCacheMisses.labels('work').inc();
    return val;
  }
  return fn();
}

function normalizeQuery(q) {
  return removeDiacritics(String(q || '').trim().toLowerCase());
}

function looksHebrew(q) {
  return /[\u0590-\u05FF]/.test(q);
}

const sha1 = s => crypto.createHash('sha1').update(String(s)).digest('hex');

async function expandQueryLLM(userQ) {
  const ck = `rag:v1:expand:${sha1(userQ)}`;
  try {
    const hit = await safeRedisGet(ck);
    if (hit) return JSON.parse(hit);
  } catch {}
  if (!openai) {
    return { primaryQuery: userQ, titleHints: [], authorHints: [], keywords: [], englishQuery: looksHebrew(userQ) ? userQ : undefined };
  }
  try {
    const sys = 'Extract book search hints from a vague user query. Return JSON {"primaryQuery":string,"titleHints":string[],"authorHints":string[],"keywords":string[]}';
    const comp = await openai.chat.completions.create({
      model: 'gpt-4o-mini', temperature: 0.2,
      messages: [ { role: 'system', content: sys }, { role: 'user', content: `Query: ${userQ}` } ],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(comp.choices[0]?.message?.content || '{}');
    const out = {
      primaryQuery: String(parsed.primaryQuery || userQ),
      titleHints: Array.isArray(parsed.titleHints) ? parsed.titleHints.slice(0, 3) : [],
      authorHints: Array.isArray(parsed.authorHints) ? parsed.authorHints.slice(0, 3) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 6) : [],
    };
    if (looksHebrew(userQ)) {
      const tr = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0.2,
        messages: [ { role: 'system', content: 'Translate to English, return only translation.' }, { role: 'user', content: userQ } ],
      });
      out.englishQuery = tr.choices[0]?.message?.content?.trim();
    }
    try { await safeRedisSet(ck, JSON.stringify(out), 86400); } catch {}
    return out;
  } catch {
    return { primaryQuery: userQ, titleHints: [], authorHints: [], keywords: [], englishQuery: looksHebrew(userQ) ? userQ : undefined };
  }
}

function buildVariants(hints, lang) {
  const base = { fields: 'key,title,author_name,first_publish_year,language,cover_i,has_fulltext,public_scan_b,ia', limit: 60 };
  let Qs = [];
  Qs.push(hints.englishQuery || hints.primaryQuery);
  hints.titleHints.forEach(t => Qs.push(`title:${t}`));
  hints.authorHints.forEach(a => Qs.push(`author:${a}`));
  if (hints.keywords?.length) Qs.push(hints.keywords.join(' '));
  // Apply language constraint inside the query (OpenLibrary ignores a 'lang' param)
  if (lang) Qs = Qs.map(q => `${q} language:${lang}`);
  const params = Qs.map(q => ({ ...base, q }));
  // de-duplicate
  const seen = new Set();
  const uniq = [];
  for (const p of params) { const k = JSON.stringify(p); if (!seen.has(k)) { seen.add(k); uniq.push(p); } }
  return uniq.slice(0, 6);
}

async function olFetch(params) {
  const url = 'https://openlibrary.org/search.json';
  const key = url + '?' + new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)])).toString();
  return cachedJson(key, 3600, async () => {
    const { data } = await axios.get(url, { params, timeout: 15000 });
    return data;
  });
}

async function olWork(workKey) {
  const url = `https://openlibrary.org${workKey}.json`;
  return cachedJson(url, 86400, async () => {
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      return data;
    } catch { return null; }
  });
}

function mapDoc(doc, enriched) {
  const work_key = (doc.key || '').startsWith('/works/') ? doc.key : `/works/${doc.key}`;
  const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
  const description = typeof enriched?.description === 'string' ? enriched.description : (enriched?.description?.value || null);
  const subjects = Array.isArray(enriched?.subjects) ? enriched.subjects : (doc.subject || []);
  // Normalize languages to ISO codes, e.g. 'heb', 'eng'
  const languagesFromWork = Array.isArray(enriched?.languages)
    ? enriched.languages
        .map(x => typeof x === 'string' ? x : (x?.key?.split('/').pop() ?? null))
        .filter(Boolean)
    : [];
  const languages = Array.isArray(doc.language) ? doc.language : languagesFromWork;
  const ia = Array.isArray(doc.ia) ? doc.ia : [];
  return {
    work_key,
    title: doc.title || null,
    authors,
    first_publish_year: doc.first_publish_year || null,
    languages,
    subjects,
    description,
    edition_key: null,
    cover_i: doc.cover_i || null,
    has_fulltext: !!doc.has_fulltext,
    public_scan: !!doc.public_scan_b,
    ia,
    metadata: doc,
  };
}

export async function ensureSchema() {
  if (!pool) return;
  await ensurePgvectorTypes();
  let client;
  try {
    try { client = await pool.connect(); } catch (e) {
      try { console.warn('[RAG] postgres connect failed; skipping schema:', e?.message || String(e)); } catch {}
      return;
    }
    try {
      try { await client.query(`CREATE EXTENSION IF NOT EXISTS vector`); } catch {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS books (
        work_key TEXT PRIMARY KEY,
        title TEXT,
        authors TEXT[],
        first_publish_year INT,
        languages TEXT[],
        subjects TEXT[],
        description TEXT,
        edition_key TEXT,
        cover_i INT,
        has_fulltext BOOLEAN,
        public_scan BOOLEAN,
        ia TEXT[],
        metadata JSONB,
        embedding VECTOR(${EMBED_DIM})
      )`);

    await client.query(`
      DO $$ BEGIN
        BEGIN
          CREATE INDEX books_vec_idx ON books
          USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END;
      END $$;`);

    await client.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS tsv tsvector;`);
    await client.query(`
      CREATE OR REPLACE FUNCTION books_tsv_update() RETURNS trigger AS $$
      BEGIN
        NEW.tsv := to_tsvector('simple',
          coalesce(NEW.title,'') || ' ' ||
          array_to_string(NEW.authors,' ') || ' ' ||
          coalesce(NEW.description,'') || ' ' ||
          array_to_string(NEW.subjects,' ') || ' ' ||
          array_to_string(NEW.languages,' ')
        );
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;`);
    await client.query(`
      DO $$ BEGIN
        BEGIN
          CREATE TRIGGER books_tsv_trg
          BEFORE INSERT OR UPDATE ON books
          FOR EACH ROW EXECUTE FUNCTION books_tsv_update();
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
      END $$;`);
    await client.query(`CREATE INDEX IF NOT EXISTS books_tsv_idx ON books USING gin (tsv);`);
    await client.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS content_hash TEXT;`);

    // Optional one-time backfill to refresh tsv including languages
    if (process.env.TSV_BACKFILL_ON_BOOT === 'true') {
      try { await client.query('UPDATE books SET title = title;'); } catch {}
    }
    } finally {
      try { client.release(); } catch {}
    }
  } catch {}
}

let LAST_ANALYZE_AT = 0;

async function upsertRows(rows) {
  if (!pool || rows.length === 0) return;
  await ensurePgvectorTypes();
  // Compute stable content hash per row
  const withHash = rows.map(r => ({ ...r, content_hash: crypto.createHash('md5').update(buildDocText(r)).digest('hex') }));

  let client;
  try {
    try { client = await pool.connect(); } catch { return; }
    // Read existing to avoid re-embedding unchanged rows
    const keys = withHash.map(r => r.work_key);
    const existing = await client.query(
      `SELECT work_key, content_hash, embedding IS NOT NULL AS has_embedding FROM books WHERE work_key = ANY($1)`,
      [keys]
    );
    const byKey = new Map(existing.rows.map(x => [x.work_key, x]));
    const needsEmbed = withHash.filter(r => {
      const ex = byKey.get(r.work_key);
      return !ex || ex.content_hash !== r.content_hash || !ex.has_embedding;
    });

    // Batch-embed only needed
    const embByKey = new Map();
    if (openai && needsEmbed.length) {
      const BATCH = 64;
      for (let i = 0; i < needsEmbed.length; i += BATCH) {
        const chunk = needsEmbed.slice(i, i + BATCH);
        try {
          const resp = await openai.embeddings.create({ model: EMBED_MODEL, input: chunk.map(r => buildDocText(r)) });
          resp.data.forEach((e, idx) => embByKey.set(chunk[idx].work_key, e.embedding));
        } catch {
          // if embedding batch fails, skip; we'll keep old embeddings
        }
      }
    }
    try {
      const skipped = Math.max(withHash.length - needsEmbed.length, 0);
      if (skipped) ragEmbedSkipped.inc(skipped);
      if (embByKey.size) ragEmbedBatched.inc(embByKey.size);
    } catch {}

    const finalRows = withHash.map(r => ({ ...r, embedding: embByKey.get(r.work_key) || null }));

    const colsArr = ['work_key','title','authors','first_publish_year','languages','subjects','description','edition_key','cover_i','has_fulltext','public_scan','ia','metadata','embedding','content_hash'];
    const cols = `(${colsArr.join(',')})`;
    const valuesSql = finalRows.map((_, i) => {
      const o = i * colsArr.length;
      const ps = [];
      for (let j = 1; j <= colsArr.length; j++) {
        if (j === 14) ps.push(`$${o + j}::vector`); else ps.push(`$${o + j}`);
      }
      return `(${ps.join(',')})`;
    }).join(',');

    const sql = `INSERT INTO books ${cols} VALUES ${valuesSql}
      ON CONFLICT (work_key) DO UPDATE SET
        title=EXCLUDED.title, authors=EXCLUDED.authors, first_publish_year=EXCLUDED.first_publish_year,
        languages=EXCLUDED.languages, subjects=EXCLUDED.subjects, description=EXCLUDED.description,
        edition_key=EXCLUDED.edition_key, cover_i=EXCLUDED.cover_i, has_fulltext=EXCLUDED.has_fulltext,
        public_scan=EXCLUDED.public_scan, ia=EXCLUDED.ia, metadata=EXCLUDED.metadata,
        content_hash=EXCLUDED.content_hash,
        embedding=COALESCE(EXCLUDED.embedding, books.embedding)`;

    const params = [];
    for (const r of finalRows) {
      params.push(
        r.work_key, r.title, r.authors, r.first_publish_year, r.languages, r.subjects, r.description, r.edition_key, r.cover_i, r.has_fulltext, r.public_scan, r.ia, r.metadata,
        r.embedding ? toSql(r.embedding) : null,
        r.content_hash,
      );
    }

    await client.query(sql, params);
    const now = Date.now();
    if (now - LAST_ANALYZE_AT > 120000) {
      await client.query('ANALYZE books;');
      LAST_ANALYZE_AT = now;
      try { ragAnalyzeRuns.inc(); } catch {}
    }
  } finally { try { client.release(); } catch {} }
}

function buildDocText(r) {
  return [r.title, (r.authors||[]).join(' '), (r.subjects||[]).join(' '), r.description || '', (r.languages||[]).join(' ')].filter(Boolean).join('\n');
}

async function getQueryEmbeddingCached(q) {
  const ck = `rag:v1:q-emb:${sha1(q)}`;
  try {
    const hit = await safeRedisGet(ck);
    if (hit) return toSql(JSON.parse(hit));
  } catch {}
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: q });
  const vec = emb.data[0].embedding;
  try { await safeRedisSet(ck, JSON.stringify(vec), 86400); } catch {}
  return toSql(vec);
}

async function hybridSearch(q, limit, langPref) {
  if (!pool) return [];
  await ensurePgvectorTypes();
  let client;
  try {
    try { client = await pool.connect(); } catch { return []; }
    const k = Math.max(limit * 3, 30);
    // Vector side
    let vecRows = [];
    if (openai) {
      try {
        const v = await getQueryEmbeddingCached(q);
        const vecSql = `
          SELECT work_key, title, authors, first_publish_year, languages, subjects, description,
                 cover_i, has_fulltext, public_scan,
                 1 - (embedding <=> $1) AS vec_score
          FROM books
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT $2;`;
        const r = await client.query(vecSql, [v, k]);
        vecRows = r.rows;
      } catch { vecRows = []; }
    }

    // FTS side
    const ftsSql = `
      SELECT work_key, title, authors, first_publish_year, languages, subjects, description,
             cover_i, has_fulltext, public_scan,
             ts_rank(tsv, plainto_tsquery('simple', $1)) AS fts_score
      FROM books
      WHERE tsv @@ plainto_tsquery('simple', $1)
      ORDER BY fts_score DESC
      LIMIT $2;`;
    const ftsRes = await client.query(ftsSql, [q, k]);

    // Merge
    const byKey = new Map();
    for (const r of vecRows) {
      byKey.set(r.work_key, { row: r, vec: Number(r.vec_score)||0, fts: 0 });
    }
    for (const r of ftsRes.rows) {
      const prev = byKey.get(r.work_key) || { row: r, vec: 0, fts: 0 };
      byKey.set(r.work_key, { row: { ...prev.row, ...r }, vec: prev.vec, fts: Number(r.fts_score)||0 });
    }
    const merged = Array.from(byKey.values()).map(({ row, vec, fts }) => {
      const langBonus = (langPref && Array.isArray(row.languages) && row.languages.includes(langPref)) ? 0.05 : 0;
      const fulltextBonus = row.has_fulltext ? 0.03 : 0;
      const coverBonus = row.cover_i ? 0.02 : 0;
      const score = (0.65 * vec) + (0.35 * fts) + langBonus + fulltextBonus + coverBonus;
      return { ...row, score, _vec: vec, _fts: fts };
    });
    return merged.sort((a,b)=> b.score - a.score).slice(0, Math.max(limit * 2, limit));
  } finally { try { client.release(); } catch {} }
}

async function rerankLLM(query, candidates, take) {
  if (!openai) return candidates.slice(0, take);
  const items = candidates.slice(0, 30).map(c => ({ work_key: c.work_key, text: buildDocText(c).slice(0, 1800) }));
  try {
    const sys = 'You are a ranking model. Score each item for how well it matches the user\'s intent. Return JSON {"rank":[{"work_key":string,"score":number}]}.';
    const out = await openai.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0, messages: [ { role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ query, items }) } ], response_format: { type: 'json_object' } });
    const rank = JSON.parse(out.choices[0]?.message?.content || '{}').rank || [];
    const scoreBy = new Map(rank.map(r => [r.work_key, r.score]));
    return candidates
      .map(c => ({ c, s: Number(scoreBy.get(c.work_key) || 0) }))
      .sort((a,b)=> b.s - a.s)
      .slice(0, take)
      .map(x => x.c);
  } catch { return candidates.slice(0, take); }
}

const QuerySchema = z.object({ q: z.string().min(1), limit: z.coerce.number().int().min(1).max(25).default(10), lang: z.string().optional() });

const USE_RERANK = (process.env.USE_RERANK || 'false') === 'true';
const RERANK_TIMEOUT_MS = Number(process.env.RERANK_TIMEOUT_MS || 6000);

async function maybeRerank(candidates, query, take) {
  if (!USE_RERANK || !openai) return candidates.slice(0, take);
  const RERANK_TAKE = 15;
  const key = `rag:v1:rerank:${sha1(query + '|' + candidates.slice(0, RERANK_TAKE).map(c=>c.work_key).join(','))}`;
  try {
    const cached = await safeRedisGet(key);
    if (cached) {
      const order = JSON.parse(cached);
      const dict = new Map(candidates.map(c => [c.work_key, c]));
      const ordered = order.map(k => dict.get(k)).filter(Boolean)
        .concat(candidates.filter(c => !order.includes(c.work_key)));
      return ordered.slice(0, take);
    }
  } catch {}

  const items = candidates.slice(0, RERANK_TAKE).map(c => ({ work_key: c.work_key, text: buildDocText(c).slice(0, 1800) }));

  const run = async () => {
    const sys = 'You are a ranking model. Score each item for how well it matches the user\'s intent. Return JSON {"rank":[{"work_key":string,"score":number}]}.';
    const out = await openai.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0, messages: [ { role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ query, items }) } ], response_format: { type: 'json_object' } });
    const rank = JSON.parse(out.choices[0]?.message?.content || '{}').rank || [];
    const scoreBy = new Map(rank.map(r => [r.work_key, r.score]));
    const ordered = candidates
      .slice(0, RERANK_TAKE)
      .map(c => ({ c, s: Number(scoreBy.get(c.work_key) || 0) }))
      .sort((a,b)=> b.s - a.s)
      .map(x => x.c)
      .concat(candidates.slice(RERANK_TAKE));
    const orderedKeys = ordered.map(x => x.work_key);
    try { await safeRedisSet(key, JSON.stringify(orderedKeys), 86400); } catch {}
    return ordered.slice(0, take);
  };

  let timeoutHit = false;
  const timeoutPromise = new Promise(resolve => setTimeout(() => { timeoutHit = true; resolve(candidates.slice(0, take)); }, RERANK_TIMEOUT_MS));
  const result = await Promise.race([ run(), timeoutPromise ]);
  if (timeoutHit) { try { ragRerankTimeouts.inc(); } catch {} }
  return result;
}

export async function handleRagSearch(req, res) {
  try {
    const reqStart = Date.now();
    ragRequests.inc();const { q, limit, lang } = QuerySchema.parse(req.query);
    const norm = normalizeQuery(q);
    const cacheKey = `rag:v1:res:${lang||''}:${limit}:${sha1(norm)}`;
    try {
      const cachedRes = await safeRedisGet(cacheKey);
      if (cachedRes) {
        try { ragFinalResultCacheHits.inc(); } catch {}
        return res.json(JSON.parse(cachedRes));
      }
    } catch {}

    const langPref = lang || (looksHebrew(q) ? 'heb' : undefined);

    // 2a) Try DB-first with the raw normalized query
    let hybrid = await hybridSearch(norm, limit, langPref);
    const MIN_FTS_RATIO = Number(process.env.RAG_MIN_FTS_RATIO || 0.4);
    const ftsHits = hybrid.filter(x => (x._fts || 0) > 0).length;
    const ftsOk = hybrid.length > 0 && (ftsHits / hybrid.length) >= MIN_FTS_RATIO;
    if (hybrid.length >= limit && ftsOk) {
      const topDb = await maybeRerank(hybrid, norm, limit);
      const dataDb = topDb.map(r => ({
        work_key: r.work_key,
        title: r.title,
        authors: r.authors || [],
        year: r.first_publish_year,
        languages: r.languages || [],
        subjects: r.subjects || [],
        description: r.description,
        cover_url: r.cover_i ? `https://covers.openlibrary.org/b/id/${r.cover_i}-L.jpg` : null,
        openlibrary_url: `https://openlibrary.org${r.work_key}`,
        has_fulltext: !!r.has_fulltext,
        public_scan: !!r.public_scan,
      }));
      const payloadDb = { query_used: norm, suggestions: { titleHints: [], authorHints: [], keywords: [] }, results: dataDb };
      console.info('[RAG]', {
        q: norm.slice(0, 120),
        ms: { total: Date.now() - reqStart, shortcircuit: true },
        sizes: { variants: 0, docs: 0, enriched: 0, final: dataDb.length },
        shortcircuit_reason: { ftsHits, candidates: hybrid.length, minFtsRatio: MIN_FTS_RATIO },
      });
      try { ragDbShortcircuitHits.inc(); } catch {}
      try { await safeRedisSet(cacheKey, JSON.stringify(payloadDb), 900); } catch {}
      return res.json(payloadDb);
    }
    const tExpand0 = Date.now();
    const hints = await expandQueryLLM(norm);
    const tExpand = Date.now() - tExpand0; try { ragPhaseDuration.labels('expand').observe(tExpand/1000); } catch {}
    const variants = buildVariants(hints, lang);
    const tOl0 = Date.now();
    const settled = await Promise.allSettled(variants.map(p => olFetch(p)));
    const tOl = Date.now() - tOl0; try { ragPhaseDuration.labels('openlibrary').observe(tOl/1000); } catch {}
    const docs = [];
    const seen = new Set();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      const ds = Array.isArray(r.value?.docs) ? r.value.docs : [];
      for (const d of ds) {
        const key = (d.key || '').startsWith('/works/') ? d.key : `/works/${d.key}`;
        if (!key || seen.has(key)) continue; seen.add(key); docs.push(d);
      }
    }
    const ENRICH_LIMIT = Math.max(2 * limit, 30);
    const enrichTop = docs.slice(0, ENRICH_LIMIT);
    const lim = pLimit(8);
    const tEnrich0 = Date.now();
    const rows = await Promise.all(enrichTop.map(d => lim(async () => mapDoc(d, await olWork((d.key||'').startsWith('/works/')?d.key:`/works/${d.key}`)))));
    await upsertRows(rows);
    const tEnrich = Date.now() - tEnrich0; try { ragPhaseDuration.labels('enrich_upsert').observe(tEnrich/1000); } catch {}

    const tHybrid0 = Date.now();
    hybrid = await hybridSearch(hints.englishQuery || hints.primaryQuery, limit, langPref);
    const tHybrid = Date.now() - tHybrid0; try { ragPhaseDuration.labels('hybrid').observe(tHybrid/1000); } catch {}
    const tRerank0 = Date.now();
    const top = await maybeRerank(hybrid, (hints.englishQuery || hints.primaryQuery || norm), limit);
    const tRerank = Date.now() - tRerank0; try { ragPhaseDuration.labels('rerank').observe(tRerank/1000); } catch {}
    const data = top.map(r => ({
      work_key: r.work_key,
      title: r.title,
      authors: r.authors || [],
      year: r.first_publish_year,
      languages: r.languages || [],
      subjects: r.subjects || [],
      description: r.description,
      cover_url: r.cover_i ? `https://covers.openlibrary.org/b/id/${r.cover_i}-L.jpg` : null,
      openlibrary_url: `https://openlibrary.org${r.work_key}`,
      has_fulltext: !!r.has_fulltext,
      public_scan: !!r.public_scan,
    }));

    // Log timings + cache stats
    console.info('[RAG]', {
      q: norm.slice(0, 120),
      ms: { expand: tExpand, ol: tOl, enrichUpsert: tEnrich, hybrid: tHybrid, rerank: tRerank, total: Date.now() - reqStart },

      sizes: { variants: variants.length, docs: docs.length, enriched: rows.length, final: data.length },
    });

    const payload = {
      query_used: hints.englishQuery || hints.primaryQuery,
      suggestions: { titleHints: hints.titleHints, authorHints: hints.authorHints, keywords: hints.keywords },
      results: data,
    };
    try { await safeRedisSet(cacheKey, JSON.stringify(payload), 900); } catch {}
    res.json(payload);
  } catch (e) {
    const isZod = e instanceof ZodError;
    const status = isZod ? 400 : 500;
    const msg = isZod ? 'Bad Request' : 'Internal Server Error';
    try { (req.log||console).error('rag.error', { message: String(e?.message || e), code: e?.code, detail: e?.detail, stack: e?.stack }); } catch {}
    res.status(status).json({ error: msg });
  }
}
