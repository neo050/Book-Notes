import client from 'prom-client';

export const register = new client.Registry();

// Default Node.js process metrics
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
register.registerMetric(httpRequestDuration);

export const ragRequests = new client.Counter({
  name: 'rag_requests_total',
  help: 'Total RAG search requests',
});
register.registerMetric(ragRequests);

export const ragPhaseDuration = new client.Histogram({
  name: 'rag_phase_duration_seconds',
  help: 'RAG phase duration in seconds',
  labelNames: ['phase'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
register.registerMetric(ragPhaseDuration);

export const ragCacheHits = new client.Counter({
  name: 'rag_cache_hits_total',
  help: 'RAG cache hits by type',
  labelNames: ['type'],
});
register.registerMetric(ragCacheHits);

export const ragCacheMisses = new client.Counter({
  name: 'rag_cache_misses_total',
  help: 'RAG cache misses by type',
  labelNames: ['type'],
});
register.registerMetric(ragCacheMisses);

export const ragAnalyzeRuns = new client.Counter({
  name: 'rag_analyze_total',
  help: 'ANALYZE runs performed after upserts',
});
register.registerMetric(ragAnalyzeRuns);

// Additional RAG metrics for observability
export const ragDbShortcircuitHits = new client.Counter({
  name: 'rag_db_shortcircuit_hits_total',
  help: 'Times DB-first path satisfied limit without OL/LLM',
});
register.registerMetric(ragDbShortcircuitHits);

export const ragFinalResultCacheHits = new client.Counter({
  name: 'rag_final_result_cache_hits_total',
  help: 'Final response cache hits',
});
register.registerMetric(ragFinalResultCacheHits);

export const ragEmbedSkipped = new client.Counter({
  name: 'rag_embed_skipped_total',
  help: 'Embeddings skipped due to unchanged content',
});
register.registerMetric(ragEmbedSkipped);

export const ragEmbedBatched = new client.Counter({
  name: 'rag_embed_batched_total',
  help: 'Embeddings created (count)',
});
register.registerMetric(ragEmbedBatched);

export const ragRerankTimeouts = new client.Counter({
  name: 'rag_rerank_timeouts_total',
  help: 'Rerank operations that timed out and fell back',
});
register.registerMetric(ragRerankTimeouts);

export function routeLabel(req) {
  // Try to capture the Express route path; fallback to original url without query
  const r = req.route?.path || req.originalUrl?.split('?')[0] || 'unknown';
  return typeof r === 'string' ? r : String(r);
}
