import { createServer } from 'node:http';
import { join, resolve, extname, sep } from 'node:path';
import { open, realpath, lstat, readFile } from 'node:fs/promises';
import { buildManagerApprovalFinding } from './demo-findings.mjs';
import { TRAVEL_POLICY } from './travel-policy.mjs';
import { constants } from 'node:fs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
const fail = status => Object.assign(new Error('Local Explorer request failed.'), { status });
function reply(req, res, status, value, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
  res.end(req.method === 'HEAD' ? undefined : typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
async function staticAsset(clientDir, path) {
  let base;
  try {
    if ((await lstat(clientDir)).isSymbolicLink()) throw fail(403);
    base = await realpath(clientDir);
  } catch (error) { throw fail(error.status || 404); }
  let target = resolve(base, `.${path === '/' ? '/index.html' : path}`);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw fail(403);
  if (!extname(target)) target = join(base, 'index.html');
  const type = MIME[extname(target)];
  if (!type) throw fail(404);
  try {
    // Reject symlinks in any path component, including the configured client dir.
    if (await realpath(target) !== target) throw fail(403);
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw fail(404);
      return { data: await file.readFile(), type };
    } finally { await file.close(); }
  } catch (error) { throw fail(error.status || 404); }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function queryOnly(params, allowed) {
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw fail(400);
}
function limitQuery(params) {
  const limit = params.get('limit');
  if (limit !== null && (!/^[1-9]\d{0,3}$/.test(limit) || Number(limit) > 1000)) throw fail(400);
  return limit === null ? '' : `?limit=${limit}`;
}
function policies() {
  const p = TRAVEL_POLICY;
  return [{
    id: p.policyId, name: p.name, description: p.text, version: p.policyVersion,
    agents: ['travel-agent'], updated: 'Local scenario policy (no captured publication timestamp)', status: 'active',
    sources: [], recommendations: [],
    rules: [{ id: p.ruleId, policyId: p.policyId, version: p.policyVersion,
      title: 'Manager approval before booking', text: p.text, description: p.text,
      tier: 'effect_anchor', applicability: { targetTools: ['travel_book'], targetApis: ['POST /api/flights/book'] },
      citation: { documentId: p.name, section: p.ruleId, exactExcerpt: p.text },
      origin: 'local scenario policy', status: 'active' }],
  }];
}
function filtered(items, params) {
  const fields = ['session_id', 'status', 'agent_id', 'workspace_id', 'eval_name', 'result', 'trace_id'];
  queryOnly(params, [...fields, 'tenant_id', 'from', 'to']);
  for (const key of ['from', 'to']) if (params.has(key) && !Number.isFinite(Date.parse(params.get(key)))) throw fail(400);
  return items.filter(item => fields.every(key => !params.has(key) || item[key] === params.get(key))
    && (!params.has('tenant_id') || item.workspace_id === params.get('tenant_id'))
    && (!params.has('from') || Date.parse(item.occurred_at) >= Date.parse(params.get('from')))
    && (!params.has('to') || Date.parse(item.occurred_at) <= Date.parse(params.get('to'))));
}

/**
 * Local, read-only demo adapter. Not production authentication or policy QA.
 * POST searches and mutations are intentionally unsupported (403). Trace views
 * project captured Session spans only, never retrieve a wider upstream trace.
 * Listener binding is restricted to loopback; port 0 is supported for tests.
 */
export function createExplorerDemoServer({ root, clientDir = root && join(root, '.runtime/explorer-client'), thelakeOrigin = 'https://thelake-staging.softprobe.ai', apiKey, workspaceId, fetchFn = fetch } = {}) {
  const text = value => typeof value === 'string' && value.length > 0 && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
  if (!text(root) || !text(clientDir) || !text(apiKey) || !text(workspaceId) || typeof fetchFn !== 'function') throw new Error('Explicit root, API key and workspace scope are required.');
  let origin;
  try { origin = new URL(thelakeOrigin); } catch { throw new Error('Invalid thelake origin.'); }
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
    || !((origin.protocol === 'https:' && origin.hostname === 'thelake-staging.softprobe.ai' && !origin.port)
      || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) throw new Error('Invalid thelake origin.');
  const cache = new Map();
  const observed = new Map();
  const waiters = [];
  let active = 0;
  async function registry() {
    let rows;
    try { rows = JSON.parse(await readFile(join(root, '.runtime/sessions.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') rows = []; else throw fail(503); }
    if (!Array.isArray(rows) || rows.some(row => !record(row) || !/^ses_[A-Za-z0-9_-]+$/.test(row.id ?? ''))
      || new Set(rows.map(row => row.id)).size !== rows.length) throw fail(503);
    const ids = new Set(rows.map(row => row.id));
    for (const id of observed.keys()) if (!ids.has(id)) observed.delete(id);
    for (const [key, entry] of cache) if (!ids.has(entry.sessionId) || entry.expires <= Date.now()) cache.delete(key);
    return ids;
  }
  async function upstream(path) {
    if (active >= 4) await new Promise(resolve => waiters.push(resolve)); else active++;
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail(504)); }, 4000); });
      return await Promise.race([timeout, (async () => {
        const response = await fetchFn(`${origin.origin}${path}`, {
          method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: controller.signal, redirect: 'error',
        });
        if (response.redirected || response.status < 200 || response.status >= 300) throw fail(response.status === 404 ? 404 : 502);
        return await response.json();
      })()]);
    } catch (error) { throw fail(error.status || 502); }
    finally {
      clearTimeout(timer);
      const next = waiters.shift();
      if (next) next(); else active--;
    }
  }
  function session(sessionId, suffix = '') {
    const key = `/v1/sessions/${encodeURIComponent(sessionId)}${suffix}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const entry = { sessionId, expires: Infinity };
    entry.promise = upstream(key).then(data => {
      if (!record(data) || data.session_id !== sessionId || (data.workspace_id != null && data.workspace_id !== workspaceId)) throw fail(502);
      const children = suffix ? data.batches : data.spans;
      if (!Array.isArray(children) || children.some(child => !record(child) || (child.session_id != null && child.session_id !== sessionId))) throw fail(502);
      if (!suffix) {
        if (data.spans.some(span => !text(span.trace_id) || !text(span.span_id))
          || (data.scores != null && (!Array.isArray(data.scores) || data.scores.some(score => !record(score) || (score.session_id != null && score.session_id !== sessionId))))) throw fail(502);
        observed.set(sessionId, new Set(data.spans.map(span => span.trace_id)));
      }
      return { data };
    }).catch(error => {
      if (!suffix) observed.delete(sessionId);
      return { status: error.status || 502 };
    }).finally(() => { entry.expires = Date.now() + 1000; });
    cache.set(key, entry);
    return entry.promise;
  }
  async function findings(ids) {
    const rows = await Promise.all([...ids].map(async sessionId => {
      const result = await session(sessionId);
      return { sessionId, ...result, finding: result.data ? buildManagerApprovalFinding({ sessionId, sessionData: result.data, workspaceId }) : null };
    }));
    return { rows, items: rows.flatMap(row => row.finding ? [row.finding] : []), unavailable_sessions: rows.filter(row => !row.data).map(row => row.sessionId) };
  }
  const server = createServer(async (req, res) => {
    try {
      const port = server.address()?.port;
      const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      const localOrigin = `http://${req.headers.host}`;
      if (!hosts.includes(req.headers.host) || (req.headers.origin !== undefined && req.headers.origin !== localOrigin)
        || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403);
      // No writes, including read-search POSTs: never relay arbitrary SQL/query bodies.
      if (!['GET', 'HEAD'].includes(req.method)) throw fail(403);
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw fail(400);
      const rawPath = req.url.split('?')[0];
      let path;
      try { path = decodeURIComponent(rawPath); } catch { throw fail(400); }
      if (/[\\\\\x00-\x1f\x7f]/.test(path) || path.split('/').some(part => part.startsWith('.'))) throw fail(403);
      if (path === '/api' || path.startsWith('/api/')) {
        const params = new URL(req.url, localOrigin).searchParams;
        const respond = value => {
          const body = JSON.stringify(value);
          // Do not echo even an upstream diagnostic containing the configured key.
          if (body.includes(apiKey)) throw fail(502);
          reply(req, res, 200, body);
        };
        if (path === '/api/ops/policies' || path === '/api/agents' || path === '/api/agents/travel-agent') {
          queryOnly(params, ['workspace_id', 'tenant_id']);
          const inScope = ['workspace_id', 'tenant_id'].every(key => !params.has(key) || params.get(key) === workspaceId);
          if (path === '/api/ops/policies') {
            const items = inScope ? policies() : [];
            return respond({ policies: items, items });
          }
          const agent = { id: 'travel-agent', name: 'Travel Agent', framework: 'OpenCode', environment: 'local demo', capture: 'disconnected', lastCapture: null, slack: null };
          if (path !== '/api/agents') { if (!inScope) throw fail(404); return respond({ agent }); }
          return respond({ agents: inScope ? [agent] : [] });
        }
        const ids = await registry();
        const match = path.match(/^\/api\/thelake\/v1\/(?:llm\/)?sessions\/(ses_[A-Za-z0-9_-]+)(\/recording)?$/);
        if (match) {
          const [, sessionId, recording] = match;
          if (!ids.has(sessionId)) throw fail(404);
          queryOnly(params, recording ? ['limit'] : []);
          const result = await session(sessionId, recording ? `/recording${limitQuery(params)}` : '');
          if (!result.data) throw fail(result.status);
          return respond(result.data);
        }
        const trace = path.match(/^\/api\/thelake\/v1\/(?:llm\/)?traces\/([^/]+)$/);
        if (trace) {
          queryOnly(params, ['session_id', 'limit']);
          limitQuery(params); // Projection is complete Session data, not upstream pagination.
          const traceId = trace[1];
          const sourceIds = [...ids].filter(id => observed.get(id)?.has(traceId) && (!params.has('session_id') || params.get('session_id') === id));
          if (!sourceIds.length) throw fail(404);
          const data = (await Promise.all(sourceIds.map(id => session(id)))).flatMap(result => result.data ? [result.data] : []);
          const spans = data.flatMap(item => item.spans.filter(span => span.trace_id === traceId));
          if (!spans.length) throw fail(404);
          return respond({ trace: { trace_id: spans[0].trace_id, ...(data.length === 1 ? { session_id: data[0].session_id } : {}) },
            spans, scores: data.flatMap(item => (item.scores ?? []).filter(score => score.trace_id === traceId)),
            ...(data.some(item => item.truncated === true) ? { truncated: true } : {}) });
        }
        if (path === '/api/ops/findings') {
          filtered([], params); // Validate before any fanout.
          const selected = params.has('session_id') ? new Set([...ids].filter(id => id === params.get('session_id'))) : ids;
          const result = await findings(selected);
          return respond({ items: filtered(result.items, params), unavailable_sessions: result.unavailable_sessions,
            provenance: 'scenario-specific deterministic demo adapter; captured Session evidence only' });
        }
        const finding = path.match(/^\/api\/ops\/findings\/([^/]+)(\/trace)?$/);
        if (finding) {
          queryOnly(params, []);
          const result = await findings(ids);
          const row = result.rows.find(row => row.finding?.finding_id === finding[1]);
          if (!row) throw fail(404);
          if (finding[2]) return respond({ trace: { spans: row.data.spans, ...(row.data.scores ? { scores: row.data.scores } : {}) } });
          return respond({ finding: row.finding });
        }
        throw fail(404);
      }
      const asset = await staticAsset(clientDir, path);
      reply(req, res, 200, asset.data, asset.type);
    } catch (error) {
      req.resume(); // Drain rejected bodies so a keep-alive connection stays parseable.
      reply(req, res, error.status || 500, { error: error.status === 403 ? 'Read-only local Explorer access denied.' : 'Local Explorer resource unavailable.' });
    }
  });
  const listen = server.listen;
  server.listen = function (...args) {
    const opts = record(args[0]) ? { ...args.shift() } : { port: args.shift() };
    if (typeof args[0] === 'string') opts.host = args.shift();
    opts.host ??= '127.0.0.1';
    if (!['localhost', '127.0.0.1'].includes(opts.host) || opts.path !== undefined || opts.fd !== undefined
      || !Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('Local Explorer requires a loopback TCP listener.');
    opts.host = '127.0.0.1';
    if (typeof args[0] === 'number') opts.backlog = args.shift();
    return listen.call(this, opts, ...args);
  };
  return server;
}
