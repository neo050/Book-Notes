import { randomUUID } from 'node:crypto';

const LEVELS = { fatal: 0, error: 10, warn: 20, info: 30, debug: 40, trace: 50 };
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const CURRENT = LEVELS[LOG_LEVEL] ?? LEVELS.info;
const JSON_MODE = (process.env.LOG_JSON ?? 'true') !== 'false';

function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 2048) return value.slice(0, 2048) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (key.includes('password') || key.includes('secret') || key.includes('token') || key === '_csrf') {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function ts() { return new Date().toISOString(); }

function write(level, msg, ctx) {
  if ((LEVELS[level] ?? 999) > CURRENT) return;
  const record = { t: ts(), level, msg, ...ctx };
  if (JSON_MODE) {
    // Ensure JSON-safe
    try { console.log(JSON.stringify(record)); } catch { console.log(JSON.stringify({ t: ts(), level, msg: String(msg) })); }
  } else {
    const extras = ctx ? ' ' + JSON.stringify(ctx) : '';
    console.log(`[${record.t}] ${level.toUpperCase()} ${msg}${extras}`);
  }
}

function base(methods, baseCtx) {
  return {
    fatal: (msg, ctx) => write('fatal', msg, { ...baseCtx, ...redact(ctx) }),
    error: (msg, ctx) => write('error', msg, { ...baseCtx, ...redact(ctx) }),
    warn:  (msg, ctx) => write('warn',  msg, { ...baseCtx, ...redact(ctx) }),
    info:  (msg, ctx) => write('info',  msg, { ...baseCtx, ...redact(ctx) }),
    debug: (msg, ctx) => write('debug', msg, { ...baseCtx, ...redact(ctx) }),
    trace: (msg, ctx) => write('trace', msg, { ...baseCtx, ...redact(ctx) }),
    child(more) { return base(methods, { ...baseCtx, ...more }); },
    // helpers
    startTimer(label) { const s = Date.now(); return () => ({ label, ms: Date.now() - s }); },
    newReqId() { return randomUUID(); },
  };
}

export const logger = base({}, {});

export function sanitize(obj) { return redact(obj); }

