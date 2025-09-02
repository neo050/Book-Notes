/* services/olSearch.js ------------------------------------------- */
import axios from 'axios';

// Query OpenLibrary for works matching the query string.
// Returns a minimal, UI-friendly shape.
export async function searchWorks(q, { limit = 10 } = {}) {
  if (!q || !q.trim()) return [];
  const { data } = await axios.get('https://openlibrary.org/search.json', {
    params: {
      q,
      limit,
      fields: 'key,title,author_name,cover_i',
    },
    timeout: 10_000,
  });

  const docs = Array.isArray(data?.docs) ? data.docs : [];
  return docs.map(d => ({
    id: d.key || '',
    title: d.title || '',
    author_name: Array.isArray(d.author_name) ? d.author_name[0] : (d.author_name || ''),
    cover_i: d.cover_i ?? 0,
  }));
}
