import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try { return timingSafeEqual(ba, bb); } catch { return false; }
}

function ipAllowed(ip, allowList) {
  if (!allowList || allowList.length === 0) return true; // if no allowlist, allow any IP (token still required)
  // allow exact matches only (simple and safe)
  return allowList.includes(ip);
}

export function authorizeMetrics(req, res, next) {
  const token = process.env.METRICS_TOKEN;
  if (!token) {
    // If no token is configured, hide the endpoint entirely.
    return res.sendStatus(404);
  }
  const header = req.headers['authorization'] || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const okToken = safeEqual(presented, token);

  // Optional IP allow-list: comma-separated list of exact IPs (as seen by Express with trust proxy enabled)
  const allows = (process.env.METRICS_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);
  const okIp = ipAllowed(req.ip, allows);

  if (!okToken || !okIp) {
    return res.status(401).send('Unauthorized');
  }
  return next();
}

