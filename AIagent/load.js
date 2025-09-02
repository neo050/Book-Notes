import fs from 'fs';
import zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray.js';
import pg from 'pg';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

await db.query(`
CREATE TABLE IF NOT EXISTS ol_works (
  work_key text PRIMARY KEY,
  title text,
  subjects text[],
  author_keys text[],
  first_year smallint,
  cover_i int,
  embedding vector(384)  -- will fill in step ③
);
`);

async function importFile(gzFile) {
  const gunzip = zlib.createGunzip();
  const p = parser({ separator: '\t' });
  const input = fs.createReadStream(gzFile);
  await pipeline(input, gunzip, splitLines(p));
}

function splitLines(p) {
  let leftover = '';
  return new stream.Writable({
    write(chunk, _enc, cb) {
      const data = leftover + chunk.toString('utf8');
      const lines = data.split('\n');
      leftover = lines.pop();
      for (const line of lines) handleLine(line);
      cb();
    },
    final(cb) { if (leftover) handleLine(leftover); cb(); }
  });
}

async function handleLine(line) {
  const [type, key, rev, mod, json] = line.split('\t');
  if (!key.startsWith('/works/')) return; // ignore authors here
  const obj = JSON.parse(json);
  const subjects = obj.subjects?.slice(0, 10) ?? [];
  const authors  = obj.authors?.map(a => a.author?.key) ?? [];
  await db.query(`
    INSERT INTO ol_works (work_key, title, subjects, author_keys, first_year, cover_i)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (work_key) DO UPDATE SET
      title=EXCLUDED.title,
      subjects=EXCLUDED.subjects,
      author_keys=EXCLUDED.author_keys,
      first_year=EXCLUDED.first_year,
      cover_i=EXCLUDED.cover_i;`,
    [key, obj.title, subjects, authors, obj.first_publish_year, obj.covers?.[0]]
  );
}

await importFile('data/works.txt.gz');
console.log('Load done');