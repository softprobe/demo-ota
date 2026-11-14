import { timingSafeEqual } from 'node:crypto';

export function publicError(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }

export function guardBrowserRequest(req, port, { allowAnyHost = false } = {}) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = req.headers.host;
  if (!host || (!allowAnyHost && !hosts.has(host))) throw publicError('Invalid local host.', 403);
  const allowedOrigins = allowAnyHost ? new Set([`http://${host}`, `https://${host}`]) : new Set([...hosts].map(item => `http://${item}`));
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw publicError('Cross-origin requests are not allowed.', 403);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!allowedOrigins.has(req.headers.origin)) throw publicError('A same-origin browser request is required.', 403);
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw publicError('JSON requests are required.', 415);
  }
}

export function checkInternalToken(header, secret) {
  if (typeof header !== 'string' || !secret) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function readJSON(req, allowedKeys, limit = 16_384) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw publicError('Request body is too large.', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw publicError('Malformed JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw publicError('A JSON object is required.');
  if (allowedKeys && Object.keys(value).some(key => !allowedKeys.includes(key))) throw publicError('Unexpected request fields.');
  return value;
}
