/* services/olSearch.js ------------------------------------------- */
import axios from 'axios';
import { logger } from '../utils/logger.js';

// Lightweight in-memory cache with TTL to avoid hammering OpenLibrary
const cache = new Map(); // key -> { at:number, data:any }
const TTL_MS = 60 * 60 * 1000; // 1 hour

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() - v.at > TTL_MS) { cache.delete(key); return null; }
  return v.data;
}
function setCache(key, data) { cache.set(key, { at: Date.now(), data }); }

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buildVariants(raw, lang) {
  const q = raw.trim();
  if (!q) return [];
  const variants = new Set();
  variants.add(q);

  // Split "title - author" or "title | author"
  const parts = q.split(/[-|–—]+/).map(s => s.trim()).filter(Boolean);
  if (parts.length === 2) {
    variants.add(`title:${parts[0]}`);
    variants.add(`author:${parts[1]}`);
  }
  // Title only "title:..." and Author only "author:..."
  const mTitle = q.match(/title\s*:\s*(.+)$/i);
  if (mTitle) variants.add(`title:${mTitle[1].trim()}`);
  const mAuthor = q.match(/author\s*:\s*(.+)$/i);
  if (mAuthor) variants.add(`author:${mAuthor[1].trim()}`);

  // Diacritics-stripped variant for Latin queries
  const noDia = stripDiacritics(q);
  if (noDia && noDia !== q) variants.add(noDia);

  let out = Array.from(variants).slice(0, 5);
  // IMPORTANT: OpenLibrary language must be inside the q string
  if (lang) out = out.map(v => `${v} language:${lang}`);
  return out;
}

async function olFetch(params) {
  const url = 'https://openlibrary.org/search.json';
  const key = url + '?' + new URLSearchParams(params).toString();
  const hit = getCache(key);
  if (hit) return hit;
  const { data } = await axios.get(url, { params, timeout: 12_000 });
  setCache(key, data);
  return data;
}

function mapDocs(docs) {
  return docs.map(d => ({
    id: d.key || '',
    title: d.title || '',
    author_name: Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || ''),
    cover_i: d.cover_i ?? 0,
    year: d.first_publish_year || '',
  }));
}

// Enhanced search using a few variants (q, title:, author:) and deduping
export async function searchWorks(q, { limit = 12, lang } = {}) {
  if (!q || !q.trim()) return [];
  const variants = buildVariants(q, lang).map(v => ({
    q: v,
    limit,
    fields: 'key,title,author_name,first_publish_year,cover_i',
  }));
  const t0 = Date.now();
  const settled = await Promise.allSettled(variants.map(p => olFetch(p)));
  const out = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const docs = Array.isArray(r.value?.docs) ? r.value.docs : [];
    for (const d of docs) {
      const key = d.key || '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(d);
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  const data = mapDocs(out);
  logger.info('ol.search', { fn: 'searchWorks', q: q.slice(0,120), variants: variants.length, hits: data.length, ms: Date.now() - t0 });
  return data;
}
