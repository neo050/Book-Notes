/* embeddings.js
   ------------------------------------------------------------ */
import { pool } from "../db/index.js";
import { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";

/* 1 - Embeddings */
export const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model:  "text-embedding-3-small",
});

/* 2 - Retrieval store (no upsert) */
export const vectorstore = await PGVectorStore.initialize(embeddings, {
   pool,
  tableName: "yt_chunks",
  dimensions:1536,
  columns: {
    idColumnName:       "id",
    contentColumnName:  "content",
    vectorColumnName:   "embedding",   
    metadataColumnName: "metadata",    
  },
  distanceStrategy: "cosine",
});

/* 3 - Splitter */
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize:   1_000,
  chunkOverlap: 200,
});

// /* 4 - Ingestion helper (idempotent) */
// export async function addYTVtoVectorStore({
//   transcript,
//   video_id,
// }) {
//   /* Split transcript */
//   const chunks  = await splitter.splitText(transcript);

//   /* Embed every chunk */
//   const embeds  = await embeddings.embedDocuments(chunks);

//   /* Build VALUES list with ::vector / ::jsonb casts */
//   const valuesSQL = chunks
//     .map(
//       (_t, i) =>
//         `($${i * 3 + 1}, $${i * 3 + 2}::vector, $${i * 3 + 3}::jsonb)`
//     )
//     .join(",");

//   /* Flatten arguments:
//      - content text
//      - embedding string "[v1,v2,…]"       ← NEW
//      - metadata JSON                       */
//   const flatArgs = chunks.flatMap((text, i) => [
//     text,
//     "[" + embeds[i].join(",") + "]",       // ← NEW  (vector literal)
//     JSON.stringify({ video_id, chunk_idx: i }),
//   ]);

//   /* Bulk insert, skip duplicates */
//   await pool.query(
//     `
//     INSERT INTO yt_chunks (content, embedding, metadata)
//     VALUES ${valuesSQL}
//     ON CONFLICT ON CONSTRAINT uniq_content_metadata DO NOTHING
//     `,
//     flatArgs
//   );

//   console.log(
//     `✅ attempted ${chunks.length} chunks for ${video_id}; duplicates skipped`
//   );
// }

export async function addYTVtoVectorStore({ transcript, video_id }) {
  const chunks = await splitter.splitText(transcript);

  const docs   = chunks.map((txt, i) =>
    new Document({
      pageContent: txt,
      metadata: { video_id, chunk_idx: i },
    })
  );

  // LangChain handles: batching, embedding, INSERT, ON CONFLICT DO NOTHING
  try {
  await vectorstore.addDocuments(docs);
} catch (e) {
  if (e.message.includes("duplicate key value")) {
    console.log("↩️  duplicate row – skipping");
  } else {
    throw e;                                  // - onward
  }
}

}


export async function fetchChunks(query, video_id, k = 8) {
  // 1. Embed the user query
  const vec = await embeddings.embedQuery(query);
  const literal = "[" + vec.join(",") + "]";        // pgvector literal

  // 2. Parameterised SQL – cosine distance
  const { rows } = await pool.query(
    `
    SELECT content
    FROM   yt_chunks
    WHERE  metadata @> $3::jsonb
    ORDER  BY embedding <#> $2::vector           -- cosine distance
    LIMIT  $1
    `,
    [k, literal, JSON.stringify({ video_id })]
  );

  return rows.map(r => ({ pageContent: r.content }));
}