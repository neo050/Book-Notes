import axios from 'axios';
import Redis from 'ioredis';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
const { Vector } = pgvector;
import pLimit from 'p-limit';
import { z, ZodError } from 'zod';
import { remove as removeDiacritics } from 'diacritics';
import OpenAI from 'openai';
import { ragRequests, ragPhaseDuration, ragCacheHits, ragCacheMisses, ragAnalyzeRuns } from '../utils/metrics.js';

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function cachedJson(key, ttlSec, fn) {
  if (redis) {
    const hit = await redis.get(key);
    if (hit) {
      if (key.includes('openlibrary.org/search.json')) ragCacheHits.labels('ol_search').inc();
      else if (key.includes('/works/')) ragCacheHits.labels('work').inc();
      return JSON.parse(hit);
    }
    const val = await fn();
    await redis.set(key, JSON.stringify(val), 'EX', ttlSec);
    if (key.includes('openlibrary.org/search.json')) ragCacheMisses.labels('ol_search').inc();
    else if (key.includes('/works/')) ragCacheMisses.labels('work').inc();
    return val;
  }
  return fn();
}

function normalizeQuery(q) {
  return removeDiacritics(String(q || '').trim());
}

function looksHebrew(q) {
  return /[\u0590-\u05FF]/.test(q);
}

async function expandQueryLLM(userQ) {
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
    return out;
  } catch {
    return { primaryQuery: userQ, titleHints: [], authorHints: [], keywords: [], englishQuery: looksHebrew(userQ) ? userQ : undefined };
  }
}

function buildVariants(hints, lang) {
  const base = { fields: 'key,title,author_name,first_publish_year,language,cover_i,has_fulltext,public_scan_b,ia', limit: 60 };
  const Qs = [];
  Qs.push(hints.englishQuery || hints.primaryQuery);
  hints.titleHints.forEach(t => Qs.push(`title:${t}`));
  hints.authorHints.forEach(a => Qs.push(`author:${a}`));
  if (hints.keywords?.length) Qs.push(hints.keywords.join(' '));
  const params = Qs.map(q => ({ ...base, q, ...(lang ? { lang } : {}) }));
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
  const languages = Array.isArray(doc.language) ? doc.language : (enriched?.languages || []);
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

async function ensureSchema() {
  if (!pool) return;
  const sql = `
  CREATE EXTENSION IF NOT EXISTS vector;
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
    embedding VECTOR(1536)
  );
  DO $$ BEGIN
    CREATE INDEX books_vec_idx ON books USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  ALTER TABLE books
    ADD COLUMN IF NOT EXISTS tsv tsvector;
  CREATE OR REPLACE FUNCTION books_tsv_update() RETURNS trigger AS $$
  BEGIN
    NEW.tsv := to_tsvector('simple',
      coalesce(NEW.title,'') || ' ' ||
      array_to_string(NEW.authors,' ') || ' ' ||
      coalesce(NEW.description,'') || ' ' ||
      array_to_string(NEW.subjects,' ')
    );
    RETURN NEW;
  END
  $$ LANGUAGE plpgsql;
  DO $$ BEGIN
    CREATE TRIGGER books_tsv_trg
    BEFORE INSERT OR UPDATE ON books
    FOR EACH ROW EXECUTE FUNCTION books_tsv_update();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE INDEX IF NOT EXISTS books_tsv_idx ON books USING gin (tsv);`;
  const client = await pool.connect();
  try { await client.query(sql); } finally { client.release(); }
}

async function upsertRows(rows) {
  if (!pool || rows.length === 0) return;
  // Generate embeddings with limited concurrency
  const limit = pLimit(4);
  const withEmb = await Promise.all(rows.map(r => limit(async () => {
    const text = buildDocText(r);
    if (openai) {
      try {
        const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
        return { ...r, embedding: emb.data[0].embedding };
      } catch {
        return { ...r, embedding: null };
      }
    }
    return { ...r, embedding: null };
  })));

  const client = await pool.connect();
  try {
    const cols = '(work_key,title,authors,first_publish_year,languages,subjects,description,edition_key,cover_i,has_fulltext,public_scan,ia,metadata,embedding)';
    const valuesSql = withEmb.map((_, i) => `($${i*14+1},$${i*14+2},$${i*14+3},$${i*14+4},$${i*14+5},$${i*14+6},$${i*14+7},$${i*14+8},$${i*14+9},$${i*14+10},$${i*14+11},$${i*14+12},$${i*14+13},$${i*14+14})`).join(',');
    const sql = `INSERT INTO books ${cols} VALUES ${valuesSql}
      ON CONFLICT (work_key) DO UPDATE SET
        title=EXCLUDED.title, authors=EXCLUDED.authors, first_publish_year=EXCLUDED.first_publish_year,
        languages=EXCLUDED.languages, subjects=EXCLUDED.subjects, description=EXCLUDED.description,
        edition_key=EXCLUDED.edition_key, cover_i=EXCLUDED.cover_i, has_fulltext=EXCLUDED.has_fulltext,
        public_scan=EXCLUDED.public_scan, ia=EXCLUDED.ia, metadata=EXCLUDED.metadata,
        embedding=COALESCE(EXCLUDED.embedding, books.embedding)`;
    const params = [];
    for (const r of withEmb) {
      params.push(
        r.work_key, r.title, r.authors, r.first_publish_year, r.languages, r.subjects, r.description, r.edition_key, r.cover_i, r.has_fulltext, r.public_scan, r.ia, r.metadata,
        r.embedding ? new Vector(r.embedding) : null,
      );
    }
    await client.query(sql, params);
  } finally { client.release(); }
}

function buildDocText(r) {
  return [r.title, (r.authors||[]).join(' '), (r.subjects||[]).join(' '), r.description || '', (r.languages||[]).join(' ')].filter(Boolean).join('\n');
}

async function hybridSearch(q, limit, langPref) {
  if (!pool) return [];
  const client = await pool.connect();
  try {
    const k = Math.max(limit * 3, 30);
    // Vector side
    let vecRows = [];
    if (openai) {
      try {
        const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: q });
        const v = new Vector(emb.data[0].embedding);
        const vecSql = `
          SELECT work_key, title, authors, first_publish_year, languages, subjects, description,
                 cover_i, has_fulltext, public_scan,
                 1 - (embedding <=> $1) AS vec_score
          FROM books
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1
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
      return { ...row, score };
    });
    return merged.sort((a,b)=> b.score - a.score).slice(0, Math.max(limit * 2, limit));
  } finally { client.release(); }
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

export async function handleRagSearch(req, res) {
  try {
    const reqStart = Date.now();
    ragRequests.inc();
    METRICS.requests++;
    const { q, limit, lang } = QuerySchema.parse(req.query);
    await ensureSchema();
    const norm = normalizeQuery(q);
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
    const enrichTop = docs.slice(0, 80);
    const lim = pLimit(8);
    const tEnrich0 = Date.now();
    const rows = await Promise.all(enrichTop.map(d => lim(async () => mapDoc(d, await olWork((d.key||'').startsWith('/works/')?d.key:`/works/${d.key}`)))));
    await upsertRows(rows);
    const tEnrich = Date.now() - tEnrich0; try { ragPhaseDuration.labels('enrich_upsert').observe(tEnrich/1000); } catch {}

    const langPref = lang || (looksHebrew(q) ? 'heb' : undefined);
    const tHybrid0 = Date.now();
    const hybrid = await hybridSearch(hints.englishQuery || hints.primaryQuery, limit, langPref);
    const tHybrid = Date.now() - tHybrid0; try { ragPhaseDuration.labels('hybrid').observe(tHybrid/1000); } catch {}
    const tRerank0 = Date.now();
    const reranked = await rerankLLM(hints.englishQuery || hints.primaryQuery, hybrid, limit);
    const tRerank = Date.now() - tRerank0; try { ragPhaseDuration.labels('rerank').observe(tRerank/1000); } catch {}
    const data = reranked.map(r => ({
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
      cache: { ol_hit: METRICS.olSearchHit, ol_miss: METRICS.olSearchMiss, work_hit: METRICS.workHit, work_miss: METRICS.workMiss, requests: METRICS.requests },
      sizes: { variants: variants.length, docs: docs.length, enriched: rows.length, final: data.length },
    });

    res.json({
      query_used: hints.englishQuery || hints.primaryQuery,
      suggestions: { titleHints: hints.titleHints, authorHints: hints.authorHints, keywords: hints.keywords },
      results: data,
    });
  } catch (e) {
    const isZod = e instanceof ZodError;
    const status = isZod ? 400 : 500;
    const msg = isZod ? 'Bad Request' : 'Internal Server Error';
    try { (req.log||console).error('rag.error', { err: String(e), stack: e?.stack }); } catch {}
    res.status(status).json({ error: msg });
  }
}
