import fs from 'fs';
import got from 'got';
import path from 'path';
import { pipeline } from 'stream/promises';

async function downloadLatest(type) {
  const url = `https://openlibrary.org/data/ol_dump_${type}_latest.txt.gz`;

  /* 1. HEAD → תאריך עדכון */
  let stamp;
  try {
    const head = await got.head(url);
    stamp = new Date(head.headers['last-modified']).toISOString().slice(0, 10);
  } catch (e) {
    console.error(`HEAD failed for ${type}:`, e.message);
    return;                  // דלג – כנראה קובץ עוד לא מוכן
  }

  const file = path.join('data', `${type}_${stamp}.txt.gz`);
  if (fs.existsSync(file)) {
    console.log(`${type} ${stamp} already downloaded`);
    return;
  }

  /* 2. GET (with stream) */
  console.log(`⬇️  Downloading ${type} ${stamp}`);
  await fs.promises.mkdir('data', { recursive: true });
  try {
    await pipeline(got.stream(url), fs.createWriteStream(file));
    console.log(`✅  ${type} saved to ${file}`);
  } catch (e) {
    console.error(`Download failed for ${type}:`, e.message);
    // מחק קובץ חלקי אם נוצר
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

await downloadLatest('works');
await downloadLatest('authors');
