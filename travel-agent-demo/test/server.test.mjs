import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../src/server.mjs';
import { BookingStore } from '../src/booking-store.mjs';
import { fileURLToPath } from 'node:url';

async function fixture(t, opts = {}) {
  let created = 0; const prompts = [];
  const engine = { async request(path, request = {}) {
    if (path === '/session') return { id: `ses_fixture_${++created}` };
    if (request.method === 'POST' && path.endsWith('/message')) { prompts.push(request.body); return { info: { role: 'assistant' }, parts: [] }; }
    if (path.endsWith('/message')) return [];
    return { healthy: true };
  } };
  const store = { getPending: () => null, getOffers: () => [], getBooking: () => null, approve: () => { throw new Error('No pending request'); } };
  const server = createGateway({ root: '/unused', engine, store, registryFilePath: null, internalToken: 'fixture-capability', maxConversations: 1, ...opts });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, override = {}) => fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...override }, body: JSON.stringify(body) });
  return { server, origin, post, prompts };
}

test('browser SDK assets are served before the app and recording writes require the local origin', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const received = [];
  const { origin, post, prompts } = await fixture(t, { root, webTelemetry: { export: async body => { received.push(body); return { success: true, ingested_count: 1 }; } } });
  const page = await (await fetch(origin)).text();
  assert.ok(page.indexOf('/softprobe-session.js') < page.indexOf('/app.js'));
  assert.ok(page.includes(`data-base-url="${origin}/api/telemetry"`));
  assert.ok(!page.includes('spk_'));
  assert.equal((await fetch(origin + '/softprobe-session.js')).status, 200);
  assert.equal((await fetch(origin + '/telemetry-session.js')).status, 200);
  const body = { resourceSpans: [] };
  assert.equal((await post('/api/telemetry/v1/traces', body)).status, 401);
  assert.equal((await post('/api/telemetry/v1/traces', body, { Authorization: 'Bearer local-web', Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post('/api/telemetry/v1/traces', body, { Authorization: 'Bearer local-web' })).status, 200);
  assert.deepEqual(received, [body]);
  assert.equal(prompts.length, 0);
});

test('gateway rejects cross-origin session creation and model-driven approval payloads', async t => {
  const { post } = await fixture(t);
  assert.equal((await post('/api/sessions', {}, { Origin: 'https://evil.example' })).status, 403);
  const response = await post('/api/sessions', {});
  assert.equal(response.status, 201);
  const { id } = await response.json();
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'Hi', approved: true })).status, 400);
  assert.equal((await post(`/api/sessions/${id}/approve`, { requestId: 'forged' })).status, 400);
  assert.equal((await post('/internal/travel/book', { sessionId: id, args: { requestId: 'forged' } })).status, 403);
});

test('a conversation continues beyond six user turns', async t => {
  const { post, prompts } = await fixture(t);
  const { id } = await (await post('/api/sessions', {})).json();
  for (let turn = 1; turn <= 7; turn += 1) {
    const response = await post(`/api/sessions/${id}/messages`, { text: `Offline fixture turn ${turn}` });
    assert.equal(response.status, 202, `turn ${turn} should be accepted`);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(prompts.length, 7);
});

test('explicitly unlimited mode allows more than one conversation', async t => {
  const { post, prompts } = await fixture(t, { maxConversations: null });
  for (let i = 0; i < 2; i += 1) {
    const { id } = await (await post('/api/sessions', {})).json();
    assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'Offline conversation fixture' })).status, 202);
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(prompts.length, 2);
});

test('unlimited mode preserves and extends a saved registry beyond 100 conversations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'travel-unlimited-registry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryFilePath = join(directory, 'sessions.json');
  const saved = Array.from({ length: 101 }, (_, index) => ({ id: `ses_saved_${index}`, used: true, turnCount: 6, busy: false }));
  await writeFile(registryFilePath, JSON.stringify(saved));
  let app;
  await assert.doesNotReject(async () => { app = await fixture(t, { registryFilePath, maxConversations: null }); }, 'saved history must load without a conversation-count cap');
  assert.equal((await app.post('/api/sessions/ses_saved_0/messages', { text: 'Continue the existing conversation' })).status, 202);
  await new Promise(resolve => setImmediate(resolve));
  const created = await app.post('/api/sessions', {});
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const persisted = JSON.parse(await readFile(registryFilePath, 'utf8'));
  assert.equal(persisted.length, 102);
  assert(saved.every(record => persisted.some(item => item.id === record.id)));
  assert.equal(persisted.find(record => record.id === 'ses_saved_0').turnCount, 7);
  assert(persisted.filter(record => record.id !== 'ses_saved_0' && record.id !== id).every(record => record.turnCount === 6));
});

test('approved conversation limit is enforced before any extra model request', async t => {
  const { post, prompts } = await fixture(t);
  const a = await (await post('/api/sessions', {})).json();
  const b = await (await post('/api/sessions', {})).json();
  assert.equal((await post(`/api/sessions/${a.id}/messages`, { text: 'Search demo flights' })).status, 202);
  assert.equal((await post(`/api/sessions/${b.id}/messages`, { text: 'Another conversation' })).status, 409);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].agent, 'travel');
  assert.deepEqual(prompts[0].model, { providerID: 'openai', modelID: 'gpt-4.1-mini' });
});

test('application calls fail closed when Session trace registration is unavailable', async t => {
  let finish;
  const inFlight = new Promise(resolve => { finish = resolve; });
  const engine = { request: async (path, options = {}) => path === '/session' ? { id: 'ses_registration' } : options.method === 'POST' ? inFlight : [] };
  let applicationCalls = 0;
  const { post, origin } = await fixture(t, { engine, registrar: { register: async () => { throw new Error('registration unavailable'); } }, travel: { search: async () => { applicationCalls += 1; return []; } } });
  const { id } = await (await post('/api/sessions', {})).json();
  await post(`/api/sessions/${id}/messages`, { text: 'Search' });
  const response = await fetch(origin + '/internal/travel/search', { method: 'POST', headers: { Authorization: 'Bearer fixture-capability', 'Content-Type': 'application/json', 'x-sp-session-id': id, traceparent: '00-1234567890abcdef1234567890abcdef-0123456789abcdef-01' }, body: JSON.stringify({ sessionId: id, args: { origin: 'LHR', destination: 'CDG', date: '2026-11-05' } }) });
  assert.equal(applicationCalls, 0);
  assert.match((await response.json()).error, /registration/);
  finish({});
});

test('a stopped turn cannot book after delayed registration even when a new turn is busy', async t => {
  let resolvePrompt; let releaseRegistration; let registrationStarted;
  const registered = new Promise(resolve => { registrationStarted = resolve; });
  const heldRegistration = new Promise(resolve => { releaseRegistration = resolve; });
  const engine = { request: async (path, options = {}) => {
    if (path === '/session') return { id: 'ses_cancel_race' };
    if (path === '/session/status') return {};
    if (path.endsWith('/abort')) { resolvePrompt?.({}); return true; }
    if (options.method === 'POST' && path.endsWith('/message')) return new Promise(resolve => { resolvePrompt = resolve; });
    return [];
  } };
  const store = new BookingStore();
  let bookings = 0;
  const { post, origin } = await fixture(t, { engine, store, registrar: { register: async () => { registrationStarted(); await heldRegistration; } }, travel: { bookAndVerify: async () => { bookings += 1; return { verified: true }; } } });
  const { id } = await (await post('/api/sessions', {})).json();
  const offer = { id: 'offer-race', flightId: 'flight-race', fareId: 'fare-race', airlineName: 'Fixture Air', flightNumber: 'XX101', origin: 'LHR', destination: 'CDG', date: '2026-11-05', departureTime: '2026-11-05T10:00:00', arrivalTime: '2026-11-05T11:30:00', total: 123, currency: 'USD', cabinClass: 'ECONOMY' };
  store.setOffers(id, [offer]);
  const pending = store.prepare(id, { offerId: offer.id, passenger: { firstName: 'Alex', lastName: 'Demo' } });
  store.approve(id, pending.id);
  await post(`/api/sessions/${id}/messages`, { text: 'Complete the approved booking' });
  const delayed = fetch(origin + '/internal/travel/book', { method: 'POST', headers: { Authorization: 'Bearer fixture-capability', 'Content-Type': 'application/json', 'x-sp-session-id': id, traceparent: '00-1234567890abcdef1234567890abcdef-0123456789abcdef-01' }, body: JSON.stringify({ sessionId: id, args: { requestId: pending.id } }) });
  await registered;
  assert.equal((await post(`/api/sessions/${id}/abort`, {})).status, 200);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'A new turn, without authorizing another booking' })).status, 202);
  releaseRegistration();
  const result = await delayed;
  assert.equal(bookings, 0);
  assert.equal(result.status, 409);
  assert.notEqual(store.getPending(id).status, 'completed');
  resolvePrompt?.({});
});

test('a failed abort keeps the model gate closed until engine idleness is confirmed', async t => {
  let canAbort = false;
  let modelCalls = 0;
  const engine = { request: async (path, options = {}) => {
    if (path === '/session') return { id: 'ses_abort_failure' };
    if (path === '/session/status') return canAbort ? {} : { ses_abort_failure: { type: 'busy' } };
    if (path.endsWith('/abort')) { if (!canAbort) throw new Error('engine unreachable'); return true; }
    if (options.method === 'POST' && path.endsWith('/message')) { modelCalls += 1; throw new Error('prompt transport timed out'); }
    return [];
  } };
  const { post } = await fixture(t, { engine });
  const { id } = await (await post('/api/sessions', {})).json();
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'First attempt' })).status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'Must not start another paid turn' })).status, 409);
  assert.equal(modelCalls, 1);
  canAbort = true;
  assert.equal((await post(`/api/sessions/${id}/abort`, {})).status, 200);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'Now a deliberate new attempt is allowed' })).status, 202);
  assert.equal(modelCalls, 2);
});

test('traveler confirmation above $600 waits for manager approval without dispatching a model continuation', async t => {
  const store = new BookingStore();
  const { origin, post, prompts } = await fixture(t, { store, maxConversations: null });
  const { id } = await (await post('/api/sessions', {})).json();
  store.setOffers(id, [
    { id: 'FL1:F1', flightId: 'FL1', fareId: 'F1', airlineName: 'Austrian Airlines', flightNumber: 'OS682', origin: 'CDG', destination: 'IST', date: '2026-11-15', departureTime: '2026-11-15T07:11:00', arrivalTime: '2026-11-15T09:05:00', total: 750, currency: 'USD', cabinClass: 'ECONOMY' },
  ]);
  const prepared = store.prepare(id, { offerId: 'FL1:F1', passenger: { firstName: 'Alex', lastName: 'Demo' } });
  const approveRes = await post(`/api/sessions/${id}/approve`, { requestId: prepared.id, injectSilentBug: false });
  assert.equal(approveRes.status, 200);
  assert.equal((await approveRes.json()).awaitingManagerApproval, true);
  const detail = await (await fetch(`${origin}/api/sessions/${id}`)).json();
  assert.equal(detail.pending.managerApproval.status, 'pending');
  assert.equal(detail.travelPolicy.threshold, 600);
  assert.equal(detail.booking, null);
  assert.equal(prompts.length, 0);
});

test('unsupported-currency confirmation fails closed before changing approval or dispatching a model call', async t => {
  const store = new BookingStore();
  const { post, prompts } = await fixture(t, { store, maxConversations: null });
  const { id } = await (await post('/api/sessions', {})).json();
  const offer = { id: 'FX:EUR', flightId: 'FX', fareId: 'EUR', airlineName: 'Fixture Air', flightNumber: 'XX101', origin: 'CDG', destination: 'IST', date: '2026-11-15', departureTime: '2026-11-15T07:11:00', arrivalTime: '2026-11-15T09:05:00', total: 750, currency: 'EUR', cabinClass: 'ECONOMY' };
  store.setOffers(id, [offer]);
  const prepared = store.prepare(id, { offerId: offer.id, passenger: { firstName: 'Alex', lastName: 'Demo' } });
  assert.equal((await post(`/api/sessions/${id}/approve`, { requestId: prepared.id, injectSilentBug: false })).status, 409);
  assert.equal(store.getPending(id).status, 'awaiting_approval');
  assert.equal(prompts.length, 0);
});

test('order tool returns the persisted approval evidence after success or uncertain-outcome recovery', async t => {
  for (const uncertain of [false, true]) {
    const store = new BookingStore();
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    t.after(() => finish({}));
    let response;
    const engine = { async request(path, request = {}) {
      if (path === '/session') return { id: 'ses_readback_fixture' };
      if (path.endsWith('/message')) return request.method === 'POST' ? gate : [];
      return { healthy: true };
    } };
    const { origin, post } = await fixture(t, { store, engine, maxConversations: null, registrar: { register: async () => {} },
      travel: { queryAndVerify: async () => structuredClone(response) } });
    const { id } = await (await post('/api/sessions', {})).json();
    const offer = { id: 'READ:FARE', flightId: 'READ', fareId: 'FARE', airlineName: 'Fixture Air', flightNumber: 'XX101', origin: 'CDG', destination: 'IST', date: '2026-11-15', departureTime: '2026-11-15T07:11:00', arrivalTime: '2026-11-15T09:05:00', total: 750, currency: 'USD', cabinClass: 'ECONOMY' };
    const passenger = { firstName: 'Alex', lastName: 'Demo' };
    store.setOffers(id, [offer]);
    const pending = store.prepare(id, { offerId: offer.id, passenger });
    store.approve(id, pending.id, { injectSilentBug: true });
    response = { bookingId: 'READ-BK', confirmationNumber: 'ABC123', status: 'CONFIRMED', verified: true, amount: 750, currency: 'USD', passenger, paymentStatus: 'PENDING', flightInfo: { flightId: offer.flightId, flightNumber: offer.flightNumber, departureAirport: offer.origin, arrivalAirport: offer.destination, departureTime: offer.departureTime, arrivalTime: offer.arrivalTime, cabinClass: offer.cabinClass } };
    if (uncertain) await assert.rejects(store.submit(id, pending.id, async () => { throw Object.assign(new Error('Timeout'), { result: { bookingId: 'READ-BK', confirmationNumber: 'ABC123' } }); }), /Timeout/);
    else await store.submit(id, pending.id, async () => response);
    assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'Read back my existing reservation.' })).status, 202);
    const result = await fetch(`${origin}/internal/travel/order`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-capability', 'x-sp-session-id': id, traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' },
      body: JSON.stringify({ sessionId: id, args: {} }) });
    assert.equal(result.status, 200);
    const verified = await result.json();
    assert.equal(verified.managerApproval?.status, 'not_requested');
    assert.equal(verified.demoFault?.kind, 'skip_manager_approval');
    assert.deepEqual(verified, store.getBooking(id));
    finish({});
  }
});

test('explicit injection continues the same selected request, including after waiting for manager approval', async t => {
  for (const confirmNormallyFirst of [false, true]) {
    const store = new BookingStore();
    const { origin, post, prompts } = await fixture(t, { store, maxConversations: null });
    const { id } = await (await post('/api/sessions', {})).json();
    const offer = { id: 'FL1:F1', flightId: 'FL1', fareId: 'F1', airlineName: 'Fixture Air', flightNumber: 'XX101', origin: 'CDG', destination: 'IST', date: '2026-11-15', departureTime: '2026-11-15T07:11:00', arrivalTime: '2026-11-15T09:05:00', total: 750, currency: 'USD', cabinClass: 'ECONOMY' };
    store.setOffers(id, [offer]);
    const prepared = store.prepare(id, { offerId: offer.id, passenger: { firstName: 'Alex', lastName: 'Demo' } });
    if (confirmNormallyFirst) assert.equal((await post(`/api/sessions/${id}/approve`, { requestId: prepared.id })).status, 200);
    assert.equal((await post(`/api/sessions/${id}/approve`, { requestId: prepared.id, injectSilentBug: true })).status, 202);
    await new Promise(resolve => setImmediate(resolve));
    const detail = await (await fetch(`${origin}/api/sessions/${id}`)).json();
    assert.equal(detail.pending.id, prepared.id);
    assert.deepEqual(detail.pending.offer, offer);
    assert.equal(detail.pending.demoFault.kind, 'skip_manager_approval');
    assert.equal(detail.pending.managerApproval.status, confirmNormallyFirst ? 'pending' : 'not_requested');
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].parts[0].text, /controlled demo fault/i);
    assert.match(prompts[0].parts[0].text, new RegExp(prepared.id));
  }
});
