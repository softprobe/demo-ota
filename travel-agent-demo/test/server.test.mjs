import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../src/server.mjs';

async function fixture(t, { travel, pending = null, initialOffers = [] } = {}) {
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
  let currentPending = savedPending;
  let currentBooking = savedPending?.result ?? null;
  let approvalCount = 0;
  let searchCount = 0;
  const store = {
    getPending: () => currentPending,
    getOffers: id => offers.get(id) ?? initialOffers,
    getBooking: () => currentBooking,
    setOffers: (id, list) => offers.set(id, list),
    prepare: (id, input) => {
      currentPending = { id: 'prepared-review', status: 'awaiting_approval', offer: (offers.get(id) ?? initialOffers).find(offer => offer.id === input.offerId), passenger: input.passenger };
      return currentPending;
    },
    approve: () => {
      approvalCount += 1;
      currentPending = { ...currentPending, status: 'approved', managerApproval: { ...currentPending.managerApproval,
        ...(currentPending.managerApproval.status === 'not_requested' ? { status: 'pending' } : {}),
      } };
    },
    cancel: () => {},
    beginPayment: (id, requestId) => {
      if (!currentPending || currentPending.id !== requestId) throw new Error('Booking request not found');
      if (currentPending.payment?.status === 'completed') return { alreadyCompleted: true, booking: currentBooking };
      if (currentPending.payment) throw new Error('Payment outcome is not clear');
      currentPending = { ...currentPending, payment: { status: 'submitting' } };
      return { alreadyCompleted: false, request: currentPending };
    },
    completePayment: (id, requestId, result) => {
      if (!currentPending || currentPending.id !== requestId) throw new Error('Booking request not found');
      currentPending = { ...currentPending, payment: { status: 'completed', result } };
      currentBooking = { ...result.booking, paymentAttempt: { status: 'completed' }, payment: result.payment };
      return currentBooking;
    },
    failPayment: (id, requestId) => { if (currentPending?.id === requestId) currentPending = { ...currentPending, payment: { status: 'uncertain' } }; },
  };
  let created = 0;
  const modelPrompts = [];
  const engine = { availableProviders() { return [{ id: 'google', label: 'Google Gemini', defaultModel: 'gemini-3.8-flash' }]; },
    resolveSelection(provider, model) { return { provider: provider ?? 'google', model: model ?? 'gemini-3.8-flash' }; },
    async request(path, request = {}) {
    if (path === '/global/health') return { healthy: true, version: '1.18.30' };
    if (path === '/session') return { id: `ses_fixture_${++created}` };
    if (path.endsWith('/message') && request.method === 'POST') { modelPrompts.push(request.body); return new Promise(() => {}); }
    if (path.endsWith('/message')) return [];
    if (path === '/session/status') return {};
    if (path.endsWith('/abort')) return true;
    return {};
  } };
  const resolvedTravel = travel ? { ...travel, async search(args) { searchCount += 1; return travel.search ? travel.search(args) : []; } } : {
    baseUrl: `http://127.0.0.1:${upstream.address().port}`,
    async search() { searchCount += 1; return [{ id: 'offer-1', flightId: 'flight-1', fareId: 'fare-1' }]; },
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
  return { origin, post, engine, upstreamRequests, modelPrompts, approvalCount: () => approvalCount, searchCount: () => searchCount, currentPending: () => currentPending };
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
  assert.deepEqual(ready.providers.map(provider => provider.id), ['google']);
  assert.equal(ready.defaultModel, 'gemini-3.8-flash');
  const rejected = await f.post('/agent/api/sessions', {}, { Origin: 'https://example.invalid' });
  assert.equal(rejected.status, 403);
  const created = await f.post('/agent/api/sessions', { provider: 'google', model: 'gemini-3.8-flash' });
  assert.equal(created.status, 201);
  const session = await created.json();
  assert.match(session.id, /^ses_fixture_/);
  assert.equal(session.provider, 'google');
  assert.equal(session.model, 'gemini-3.8-flash');
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

test('a search after preparing in the same agent turn cannot replace the review', async t => {
  const f = await fixture(t);
  const session = await (await f.post('/agent/api/sessions', {})).json();
  await f.post(`/agent/api/sessions/${session.id}/messages`, { text: 'Prepare this selected flight' });
  const capability = { Authorization: 'Bearer fixture-capability', Origin: null };
  const payload = { sessionId: session.id };
  assert.equal((await f.post('/agent/internal/travel/search', { ...payload, args: { origin: 'LHR', destination: 'CDG', date: '2026-11-30' } }, capability)).status, 200);
  assert.equal((await f.post('/agent/internal/travel/prepare', { ...payload, args: { offerId: 'offer-1', firstName: 'Alex', lastName: 'Demo' } }, capability)).status, 200);
  const secondSearch = await f.post('/agent/internal/travel/search', { ...payload, args: { origin: 'LHR', destination: 'CDG', date: '2026-12-01' } }, capability);
  assert.equal(secondSearch.status, 409);
  assert.match((await secondSearch.json()).error, /review was just prepared/i);
  assert.equal(f.searchCount(), 1);
  assert.equal(f.currentPending().id, 'prepared-review');
});

test('a selected offer is locked against re-search and must be the offer prepared', async t => {
  const f = await fixture(t, { initialOffers: [{ id: 'offer-1', flightId: 'flight-1', fareId: 'fare-1' }] });
  const session = await (await f.post('/agent/api/sessions', {})).json();
  const selection = await f.post(`/agent/api/sessions/${session.id}/messages`, {
    text: 'I would like to review offer offer-1. Ask for first and last name if needed. Do not search again; prepare this exact offer only. Do not book it yet.',
    offerId: 'offer-1',
  });
  assert.equal(selection.status, 202);
  const capability = { Authorization: 'Bearer fixture-capability', Origin: null };
  const payload = { sessionId: session.id };
  const search = await f.post('/agent/internal/travel/search', { ...payload, args: { origin: 'CDG', destination: 'LHR', date: '2026-11-30' } }, capability);
  assert.equal(search.status, 409);
  assert.match((await search.json()).error, /selected a flight/i);
  assert.equal(f.searchCount(), 0);
  const wrong = await f.post('/agent/internal/travel/prepare', { ...payload, args: { offerId: 'offer-2', firstName: 'Alex', lastName: 'Demo' } }, capability);
  assert.equal(wrong.status, 409);
  const prepared = await f.post('/agent/internal/travel/prepare', { ...payload, args: { offerId: 'offer-1', firstName: 'Alex', lastName: 'Demo' } }, capability);
  assert.equal(prepared.status, 200);
  assert.equal(f.currentPending().offer.id, 'offer-1');
});

test('traveler confirmation above $1,000 waits for manager approval without another model turn', async t => {
  const pending = {
    id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', status: 'awaiting_approval',
    offer: { currency: 'USD', total: 1250 }, managerApproval: { status: 'not_requested' },
  };
  const f = await fixture(t, { pending });
  const session = await (await f.post('/agent/api/sessions', {})).json();
  const response = await f.post(`/agent/api/sessions/${session.id}/approve`, { requestId: pending.id });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).awaitingManagerApproval, true);
  assert.equal(f.approvalCount(), 1);
  assert.equal(f.modelPrompts.length, 0);
});

test('booking confirmation exposes only booking and order tools to the model', async t => {
  const pending = {
    id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', status: 'awaiting_approval',
    offer: { currency: 'USD', total: 750 }, managerApproval: { status: 'not_required' },
  };
  const f = await fixture(t, { pending });
  const session = await (await f.post('/agent/api/sessions', {})).json();
  const response = await f.post(`/agent/api/sessions/${session.id}/approve`, { requestId: pending.id, injectSilentBug: false });
  assert.equal(response.status, 202);
  assert.deepEqual(f.modelPrompts.at(-1).allowedTools, ['travel_book', 'travel_order']);
  const blockedSearch = await f.post('/agent/internal/travel/search', { sessionId: session.id, args: { origin: 'CDG', destination: 'LHR', date: '2026-11-30' } }, { Authorization: 'Bearer fixture-capability', Origin: null });
  assert.equal(blockedSearch.status, 409);
  assert.match((await blockedSearch.json()).error, /already has a confirmed or submitted booking/i);
  assert.equal(f.searchCount(), 0);
});

test('the payment route verifies one existing booking and never invokes flight search', async t => {
  const pending = {
    id: 'abcdefab-cdef-4abc-8def-abcdefabcdef', status: 'completed',
    offer: { currency: 'USD', total: 750 },
    result: { bookingId: 'booking-1', confirmationNumber: 'ABC123', status: 'CONFIRMED', paymentStatus: 'PENDING', verified: true },
  };
  let paymentCalls = 0;
  const paymentResult = {
    payment: { paymentId: 'payment-1', transactionId: 'transaction-1', status: 'SUCCESS', bookingId: 'booking-1', amount: 750, currency: 'USD', paymentMethod: 'CREDIT_CARD', paymentDate: null },
    booking: { bookingId: 'booking-1', confirmationNumber: 'ABC123', status: 'TICKETED', paymentStatus: 'PAID', verified: true },
  };
  const f = await fixture(t, { pending, travel: { async payAndVerify(request) { paymentCalls += 1; assert.equal(request.id, pending.id); return paymentResult; } } });
  const session = await (await f.post('/agent/api/sessions', {})).json();
  const first = await f.post(`/agent/api/sessions/${session.id}/pay`, { requestId: pending.id });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).booking.payment.paymentId, 'payment-1');
  const repeated = await f.post(`/agent/api/sessions/${session.id}/pay`, { requestId: pending.id });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).paid, true);
  assert.equal(paymentCalls, 1);
  assert.equal(f.searchCount(), 0);
  assert.deepEqual(f.modelPrompts, []);
});

test('the original OTA API remains reachable through the root proxy', async t => {
  const f = await fixture(t);
  const response = await fetch(f.origin + '/api/flights/search');
  assert.equal(response.status, 200);
  assert.equal(f.upstreamRequests.at(-1).url, '/api/flights/search');
});
