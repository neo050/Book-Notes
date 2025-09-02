import pg from 'pg';
import fs from 'fs';
import { HNSWLib } from 'hnswlib-node';
import { pipeline } from 'stream/promises';
import { pipeline as pipeCb } from 'stream';
import { pipeline as pipe } from 'stream/promises';
import { pipeline as _ } from 'stream/promises';
import {
  AutoModel,
  AutoTokenizer,
  pipeline as hfPipeline
} from '@xenova/transformers';

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// 1. load model (first run downloads ~90 MB ONNX)
const embedder = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

// 2. fetch rows without embedding
const { rows } = await db.query('SELECT work_key, title FROM ol_works WHERE embedding IS NULL LIMIT 5000');
console.log('Rows to embed:', rows.length);

const vectors = [];
for (const r of rows) {
  const output = await embedder(r.title, { pooling: 'mean', normalize: true });
  vectors.push(output.data);
  await db.query('UPDATE ol_works SET embedding=$1 WHERE work_key=$2', [output.data, r.work_key]);
}

// 3. build HNSW index
const dim = 384;
const hnsw = new HNSWLib('cosine', dim);
hnsw.initIndex(rows.length, 16, 200);
rows.forEach((r, i) => hnsw.addPoint(vectors[i], i));
hnsw.saveIndex('vector_store/ol_works_hnsw.bin');
fs.writeFileSync('vector_store/id_lookup.json', JSON.stringify(rows.map(r => r.work_key)));
console.log('Vector index saved');