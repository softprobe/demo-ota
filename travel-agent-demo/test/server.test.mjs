import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../src/server.mjs';

async function fixture(t, { travel, pending = null } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const upstreamRequests = [];
  const upstream = createHttpServer((req, res) => {
    upstreamRequests.push({ url: req.url, method: req.method });
    if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<main>Original OTA app</main>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const savedPending = pending;
  const offers = new Map();
  let approvalCount = 0;
  const store = {
    getPending: () => savedPending,
    getOffers: id => offers.get(id) ?? [],
    getBooking: () => null,
    setOffers: (id, list) => offers.set(id, list),
    approve: () => { approvalCount += 1; savedPending.managerApproval.status = 'pending'; },
    cancel: () => {},
  };
  let created = 0;
  const modelPrompts = [];
  const engine = { async request(path, request = {}) {
    if (path === '/global/health') return { healthy: true, version: '1.18.30' };
    if (path === '/session') return { id: `ses_fixture_${++created}` };
    if (path.endsWith('/message') && request.method === 'POST') { modelPrompts.push(request.body); return new Promise(() => {}); }
    if (path.endsWith('/message')) return [];
    if (path === '/session/status') return {};
    if (path.endsWith('/abort')) return true;
    return {};
  } };
  const resolvedTravel = travel ?? {
    baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    async search() { return [{ id: 'offer-1', flightId: 'flight-1', fareId: 'fare-1' }]; },
  };
  const server = createGateway({ root, engine, store, internalToken: 'fixture-capability', travel: resolvedTravel, maxConversations: null, registryFilePath: null, basePath: '/agent' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => {
    const merged = { Origin: origin, 'Content-Type': 'application/json', ...headers };
    for (const [name, value] of Object.entries(merged)) if (value === null) delete merged[name];
    return fetch(origin + path, { method: 'POST', headers: merged, body: JSON.stringify(body) });
  };
  return { origin, post, engine, upstreamRequests, modelPrompts, approvalCount: () => approvalCount };
}

test('original OTA stays at / while the agent page and assets live under /agent', async t => {
  const f = await fixture(t);
  const original = await fetch(f.origin + '/');
  assert.equal(original.status, 200);
  assert.match(await original.text(), /Original OTA app/);
  const page = await fetch(f.origin + '/agent');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /demo-ota/);
  assert.ok(html.includes('/agent/styles.css'));
  assert.ok(html.includes('/agent/app.js'));
  assert.doesNotMatch(html, /telemetry|softprobe|Open in Softprobe/i);
  assert.equal((await fetch(f.origin + '/agent/app.js')).status, 200);
  assert.equal((await fetch(f.origin + '/agent/styles.css')).status, 200);
  assert.deepEqual(f.upstreamRequests.map(row => row.url), ['/']);
});

test('agent API uses the /agent prefix and rejects cross-origin writes', async t => {
  const f = await fixture(t);
  const status = await fetch(f.origin + '/agent/api/status');
  assert.equal(status.status, 200);
  const ready = await status.json();
  assert.equal(ready.ready, true);
  assert.equal(ready.environment, 'local synthetic demo');
  const rejected = await f.post('/agent/api/sessions', {}, { Origin: 'https://example.invalid' });
  assert.equal(rejected.status, 403);
  const created = await f.post('/agent/api/sessions', {});
  assert.equal(created.status, 201);
  assert.match((await created.json()).id, /^ses_fixture_/);
});

test('agent travel tools need the local capability only', async t => {
  const f = await fixture(t);
  const session = await (await f.post('/agent/api/sessions', {})).json();
  await f.post(`/agent/api/sessions/${session.id}/messages`, { text: 'Search for flights' });
  const payload = { sessionId: session.id, args: { origin: 'LHR', destination: 'CDG', date: '2026-11-30' } };
  const missingCapability = await f.post('/agent/internal/travel/search', payload);
  assert.equal(missingCapability.status, 403);
  const authorized = await f.post('/agent/internal/travel/search', payload, { Authorization: 'Bearer fixture-capability', Origin: null });
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json()).offers[0].offerId, 'offer-1');
});

test('traveler confirmation above $600 waits for manager approval without another model turn', async t => {
  const pending = {
    id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', status: 'awaiting_approval',
    offer: { currency: 'USD', total: 750 }, managerApproval: { status: 'not_requested' },
  };
  const f = await fixture(t, { pending });
  const session = await (await f.post('/agent/api/sessions', {})).json();
  const response = await f.post(`/agent/api/sessions/${session.id}/approve`, { requestId: pending.id });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).awaitingManagerApproval, true);
  assert.equal(f.approvalCount(), 1);
  assert.equal(f.modelPrompts.length, 0);
});

test('the original OTA API remains reachable through the root proxy', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/api/flights/search');
  assert.equal(response.status, 200);
  assert.equal(f.upstreamRequests.at(-1).url, '/api/flights/search');
});
