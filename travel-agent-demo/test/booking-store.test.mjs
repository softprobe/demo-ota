import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BookingStore } from '../src/booking-store.mjs';

const offer = {
  id: 'offer-1', flightId: 'flight-1', fareId: 'fare-1',
  origin: 'SFO', destination: 'LAX', date: '2026-11-15',
  flightNumber: 'DEMO101', departureTime: '2026-11-15T10:00:00',
  arrivalTime: '2026-11-15T11:30:00', cabinClass: 'ECONOMY',
  airlineName: 'Demo Air', total: 149, currency: 'USD',
};
const passenger = { firstName: 'Alex', lastName: 'Demo' };

function verifiedBooking() {
  return {
    bookingId: 'booking-1', confirmationNumber: 'ABC123', status: 'CONFIRMED',
    paymentStatus: 'PENDING', verified: true, amount: offer.total, currency: offer.currency,
    paymentInfo: { paymentId: null, paymentMethod: null, paymentStatus: 'PENDING', paymentDate: null },
    passenger: { ...passenger },
    flightInfo: {
      flightId: offer.flightId, flightNumber: offer.flightNumber,
      departureAirport: offer.origin, arrivalAirport: offer.destination,
      departureTime: offer.departureTime, arrivalTime: offer.arrivalTime, cabinClass: offer.cabinClass,
    },
  };
}

function paidResult(request) {
  const booking = {
    ...verifiedBooking(), status: 'TICKETED', paymentStatus: 'PAID',
    paymentInfo: { paymentId: 'payment-1', paymentMethod: 'CREDIT_CARD', paymentStatus: 'PAID', paymentDate: '2026-11-06T12:00:00' },
  };
  return {
    payment: {
      paymentId: 'payment-1', transactionId: 'transaction-1', status: 'SUCCESS',
      bookingId: request.result.bookingId, amount: offer.total, currency: offer.currency,
      paymentMethod: 'CREDIT_CARD', paymentDate: '2026-11-06T12:00:00',
      apiStatus: 'SUCCESS', apiMessage: 'Payment and ticket issue succeeded', apiResponseVerified: true,
    },
    booking,
  };
}

function prepared(store = new BookingStore(), sessionId = 'session-a') {
  store.setOffers(sessionId, [offer]);
  const request = store.prepare(sessionId, { offerId: offer.id, passenger });
  return { store, request };
}

const hasStatus = statusCode => error => error.statusCode === statusCode;

async function unresolved(store = new BookingStore(), partial = {}) {
  const { request } = prepared(store);
  store.approve('session-a', request.id);
  const error = Object.assign(new Error('Uncertain backend outcome'), partial);
  await assert.rejects(store.submit('session-a', request.id, async () => { throw error; }), caught => caught === error);
  return { store, request };
}

function persistentStore(t, extra = {}) {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(scratch, 'booking-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'runtime', 'bookings.json');
  const options = { filePath, now: () => 1_000, ...extra };
  return { store: new BookingStore(options), filePath, root, options };
}

function blockWrites(filePath) {
  const saved = `${filePath}.saved`;
  renameSync(filePath, saved);
  mkdirSync(filePath);
  return () => {
    rmSync(filePath, { recursive: true, force: true });
    renameSync(saved, filePath);
  };
}

test('initial submission requires the same verified identity as later read-back', async () => {
  for (const result of [{}, { ...verifiedBooking(), verified: undefined }, { ...verifiedBooking(), flightInfo: { ...verifiedBooking().flightInfo, fareId: 'unapproved-fare' } }]) {
    const { store, request } = prepared();
    store.approve('session-a', request.id);
    await assert.rejects(() => store.submit('session-a', request.id, async () => result), hasStatus(409));
    assert.equal(store.getPending('session-a').status, 'uncertain');
  }
});

test('payment persists a one-shot barrier and exposes the verified paid order', async () => {
  const { store, request } = prepared();
  store.approve('session-a', request.id);
  await store.submit('session-a', request.id, async () => verifiedBooking());
  const attempt = store.beginPayment('session-a', request.id);
  assert.equal(attempt.alreadyCompleted, false);
  assert.equal(attempt.request.payment.status, 'submitting');
  assert.equal(store.getBooking('session-a').paymentAttempt.status, 'submitting');
  const result = store.completePayment('session-a', request.id, paidResult(attempt.request));
  assert.equal(result.status, 'TICKETED');
  assert.equal(result.paymentStatus, 'PAID');
  assert.equal(result.payment.paymentId, 'payment-1');
  assert.equal(result.paymentAttempt.status, 'completed');
  assert.equal(store.beginPayment('session-a', request.id).alreadyCompleted, true);
  assert.equal(store.getBooking('session-a').paymentStatus, 'PAID');
});

test('uncertain and restarted payments cannot be repeated', async t => {
  const { store, options } = persistentStore(t);
  store.setOffers('session-a', [offer]);
  const preparedRequest = store.prepare('session-a', { offerId: offer.id, passenger });
  store.approve('session-a', preparedRequest.id);
  await store.submit('session-a', preparedRequest.id, async () => verifiedBooking());
  store.beginPayment('session-a', preparedRequest.id);
  const restarted = new BookingStore(options);
  assert.equal(restarted.getBooking('session-a').paymentAttempt.status, 'uncertain');
  assert.throws(() => restarted.beginPayment('session-a', preparedRequest.id), hasStatus(409));
  const reconciled = restarted.completeReadBack('session-a', preparedRequest.id, paidResult(restarted.getPending('session-a')).booking);
  assert.equal(reconciled.paymentStatus, 'PAID');
  assert.equal(reconciled.paymentAttempt.status, 'completed');
  assert.equal(reconciled.payment.transactionId, null);
  const persisted = new BookingStore(options);
  assert.equal(persisted.getPending('session-a').payment.status, 'completed');
  assert.equal(persisted.getBooking('session-a').paymentStatus, 'PAID');
});

test('getOffers exposes only defensive copies of the session search results', () => {
  const store = new BookingStore();
  const input = [structuredClone(offer)];
  store.setOffers('session-a', input);
  input[0].total = 1;
  input.push({ ...offer, id: 'forged' });
  const output = store.getOffers('session-a');
  assert.deepEqual(output, [offer]);
  output[0].fareId = 'tampered';
  output.pop();
  assert.deepEqual(store.getOffers('session-a'), [offer]);
  assert.deepEqual(store.getOffers('session-b'), []);
});

test('prepare rejects unsafe or oversized names and unknown input fields without replacing the request', () => {
  const { store, request } = prepared();
  const invalidPassengers = [
    null, [], {}, { firstName: 'Alex' },
    { ...passenger, email: 'alex@example.com' },
    { ...passenger, firstName: 42 },
    ...['', ' ', ' Alex', 'Alex ', 'ElevenChars', 'A\nB', 'A\rB', 'A\tB', 'A\u0000B', 'A\u007fB', 'A\u202eB', 'Élodie', '<b>A</b>', 'A&B', 'Demo/Name'].flatMap(name => [
      { ...passenger, firstName: name }, { ...passenger, lastName: name },
    ]),
  ];
  const invalidInputs = invalidPassengers.map(passenger => ({ offerId: offer.id, passenger }));
  invalidInputs.push(null, undefined, [], {}, { offerId: offer.id, passenger, approved: true });
  for (const input of invalidInputs) {
    assert.throws(() => store.prepare('session-a', input), hasStatus(400), JSON.stringify(input));
    assert.deepEqual(store.getPending('session-a'), request);
  }
  const accepted = store.prepare('session-a', {
    offerId: offer.id, passenger: { firstName: 'Anne-Marie', lastName: "O'Neil" },
  });
  assert.equal(accepted.passenger.firstName, 'Anne-Marie');
});

test('prepare accepts only a literal offer ID from the same session search', () => {
  const { store, request } = prepared();
  store.setOffers('session-b', [{ ...offer, id: 'other-offer' }]);
  for (const sessionId of ['session-b', 'unknown-session']) {
    assert.throws(() => store.prepare(sessionId, { offerId: offer.id, passenger }), hasStatus(404));
  }
  assert.throws(() => store.prepare('session-a', { offerId: 'forged', passenger }), hasStatus(404));
  for (const offerId of [null, 1, {}, [], '']) {
    assert.throws(() => store.prepare('session-a', { offerId, passenger }), hasStatus(400));
  }
  assert.deepEqual(store.getPending('session-a'), request);
});

test('prepare binds a pending booking to an offer returned to this session', () => {
  const store = new BookingStore();
  store.setOffers('session-a', [offer]);
  const request = store.prepare('session-a', { offerId: offer.id, passenger });
  assert.equal(request.status, 'awaiting_approval');
  assert.deepEqual(request.offer, offer);
  assert.deepEqual(request.passenger, passenger);
  assert.ok(request.id);
  assert.equal(store.getPending('session-a').id, request.id);
});

test('booking is blocked until human approval and a duplicate submission does not book twice', async () => {
  const store = new BookingStore();
  store.setOffers('session-a', [offer]);
  const request = store.prepare('session-a', { offerId: offer.id, passenger });
  let bookings = 0;
  const book = async () => { bookings += 1; return verifiedBooking(); };
  await assert.rejects(() => store.submit('session-a', request.id, book), /approval/i);
  assert.equal(bookings, 0);
  store.approve('session-a', request.id);
  const result = await store.submit('session-a', request.id, book);
  assert.equal(result.bookingId, 'booking-1');
  assert.deepEqual(await store.submit('session-a', request.id, book), result);
  assert.equal(bookings, 1);
});

test('a new search invalidates any unsubmitted selection even when the offer ID is reused', async () => {
  for (const approved of [false, true]) {
    const { store, request } = prepared();
    if (approved) store.approve('session-a', request.id);
    const refreshed = { ...offer, total: 175 };
    store.setOffers('session-a', [refreshed]);
    assert.equal(store.getPending('session-a').status, 'cancelled');
    assert.throws(() => store.approve('session-a', request.id), hasStatus(409));
    let calls = 0;
    await assert.rejects(store.submit('session-a', request.id, async () => { calls += 1; }), hasStatus(409));
    assert.equal(calls, 0);
    const next = store.prepare('session-a', { offerId: offer.id, passenger });
    assert.notEqual(next.id, request.id);
    assert.equal(next.status, 'awaiting_approval');
    assert.equal(next.offer.total, 175);
  }
});

test('cancellation invalidates only the matching unsubmitted request', async () => {
  for (const approved of [false, true]) {
    const { store, request } = prepared();
    if (approved) store.approve('session-a', request.id);
    assert.throws(() => store.cancel('session-b', request.id), hasStatus(404));
    assert.throws(() => store.cancel('session-a', 'forged'), hasStatus(404));
    const cancelled = store.cancel('session-a', request.id);
    assert.equal(cancelled.status, 'cancelled');
    cancelled.status = 'approved';
    assert.equal(store.cancel('session-a', request.id).status, 'cancelled');
    assert.throws(() => store.approve('session-a', request.id), hasStatus(409));
    let calls = 0;
    await assert.rejects(store.submit('session-a', request.id, async () => { calls += 1; }), hasStatus(409));
    assert.equal(calls, 0);
    assert.notEqual(store.prepare('session-a', { offerId: offer.id, passenger }).id, request.id);
  }
});

test('unsubmitted requests expire at the deadline without requiring a prior read', async () => {
  const defaultStore = new BookingStore({ now: () => 1_000 });
  assert.equal(prepared(defaultStore).request.expiresAt, 1_000 + 15 * 60 * 1_000);
  for (const operation of ['approve', 'submit', 'cancel', 'getPending']) {
    let now = 1_000;
    const { store, request } = prepared(new BookingStore({ now: () => now, ttlMs: 25 }));
    assert.equal(request.expiresAt, 1_025);
    now = 1_024;
    assert.equal(store.getPending('session-a').status, 'awaiting_approval');
    if (operation !== 'approve') store.approve('session-a', request.id);
    now = 1_025;
    let calls = 0;
    if (operation === 'submit') {
      await assert.rejects(store.submit('session-a', request.id, async () => { calls += 1; }), hasStatus(409));
    } else if (operation !== 'getPending') {
      assert.throws(() => store[operation]('session-a', request.id), hasStatus(409));
    }
    assert.equal(store.getPending('session-a').status, 'expired');
    assert.equal(calls, 0);
    const next = store.prepare('session-a', { offerId: offer.id, passenger });
    assert.notEqual(next.id, request.id);
    assert.equal(next.expiresAt, 1_050);
  }
});

test('an in-flight submission cannot be duplicated or replaced, even after expiry or a new search', async () => {
  let now = 1_000;
  const { store, request } = prepared(new BookingStore({ now: () => now, ttlMs: 25 }));
  store.approve('session-a', request.id);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const book = async () => { calls += 1; await gate; return verifiedBooking(); };
  const inFlight = store.submit('session-a', request.id, book);
  assert.equal(store.getPending('session-a').status, 'submitting');
  try {
    now = 2_000;
    store.setOffers('session-a', [offer]);
    assert.equal(store.getPending('session-a').status, 'submitting');
    await assert.rejects(store.submit('session-a', request.id, book), hasStatus(409));
    assert.throws(() => store.approve('session-a', request.id), hasStatus(409));
    assert.throws(() => store.cancel('session-a', request.id), hasStatus(409));
    assert.throws(() => store.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
    assert.equal(calls, 1);
  } finally {
    release();
    await inFlight;
  }
  assert.equal(store.getPending('session-a').status, 'completed');
  store.setOffers('session-a', [offer]);
  assert.throws(() => store.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
  assert.throws(() => store.cancel('session-a', request.id), hasStatus(409));
  assert.deepEqual(await store.submit('session-a', request.id, book), verifiedBooking());
  assert.equal(calls, 1);
});

test('backend errors remain uncertain without retry and retain defensive copies of partial references', async () => {
  for (const partial of [
    {},
    { confirmationNumber: 'CONF-1' },
    { result: { bookingId: 'booking-1', confirmationNumber: 'CONF-1', verified: true, passenger: { ...passenger } } },
  ]) {
    const { store, request } = prepared();
    store.approve('session-a', request.id);
    const error = Object.assign(new Error('Mutation outcome unknown'), structuredClone(partial));
    let calls = 0;
    const book = async () => { calls += 1; throw error; };
    await assert.rejects(store.submit('session-a', request.id, book), caught => caught === error);
    assert.equal(store.getPending('session-a').status, 'uncertain');
    const expected = partial.result
      ? { ...partial.result, verified: false }
      : partial.confirmationNumber ? { confirmationNumber: partial.confirmationNumber, verified: false } : null;
    assert.deepEqual(store.getBooking('session-a'), expected);
    assert.equal(store.getBooking('session-b'), null);
    if (error.result) error.result.passenger.firstName = 'Changed';
    if (expected) store.getBooking('session-a').confirmationNumber = 'forged';
    assert.deepEqual(store.getBooking('session-a'), expected);
    store.setOffers('session-a', [offer]);
    assert.equal(store.getPending('session-a').status, 'uncertain');
    assert.throws(() => store.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
    assert.throws(() => store.approve('session-a', request.id), hasStatus(409));
    assert.throws(() => store.cancel('session-a', request.id), hasStatus(409));
    await assert.rejects(store.submit('session-a', request.id, book), hasStatus(409));
    assert.equal(calls, 1);
  }
});

test('request and booking boundaries never expose mutable internal objects', async () => {
  const store = new BookingStore();
  assert.deepEqual(Object.keys(store), []);
  assert.equal(store.getBooking('session-a'), null);
  store.setOffers('session-a', [offer]);
  const inputPassenger = { ...passenger };
  const request = store.prepare('session-a', { offerId: offer.id, passenger: inputPassenger });
  const requestId = request.id;
  inputPassenger.firstName = 'Changed';
  request.passenger.lastName = 'Changed';
  request.offer.total = 1;
  request.status = 'approved';
  store.getPending('session-a').status = 'approved';
  assert.equal(store.getPending('session-a').status, 'awaiting_approval');
  const approved = store.approve('session-a', requestId);
  approved.passenger.firstName = 'Changed';
  const backendResult = verifiedBooking();
  const result = await store.submit('session-a', requestId, async callbackRequest => {
    assert.deepEqual(callbackRequest.passenger, passenger);
    assert.deepEqual(callbackRequest.offer, offer);
    callbackRequest.passenger.firstName = 'Changed';
    callbackRequest.offer.total = 1;
    callbackRequest.status = 'approved';
    return backendResult;
  });
  const expected = structuredClone(backendResult);
  backendResult.passenger.firstName = 'Changed';
  result.bookingId = 'forged';
  store.getBooking('session-a').passenger.lastName = 'Changed';
  store.getPending('session-a').result.bookingId = 'forged';
  assert.deepEqual(store.getBooking('session-a'), expected);
  assert.deepEqual(store.getPending('session-a').passenger, passenger);
  assert.deepEqual(store.getPending('session-a').offer, offer);
  const repeat = await store.submit('session-a', requestId, () => assert.fail('duplicate callback'));
  repeat.passenger.firstName = 'Changed';
  assert.deepEqual(store.getBooking('session-a'), expected);
});

test('matching verified read-back resolves uncertainty without another mutation and returns clones', async () => {
  const { store, request } = await unresolved(new BookingStore(), {
    result: { bookingId: 'booking-1', confirmationNumber: 'ABC123' },
  });
  const input = verifiedBooking();
  const output = store.completeReadBack('session-a', request.id, input);
  assert.deepEqual(output, verifiedBooking());
  assert.equal(store.getPending('session-a').status, 'completed');
  input.passenger.firstName = 'Changed';
  output.flightInfo.flightId = 'forged';
  assert.deepEqual(store.getBooking('session-a'), verifiedBooking());
  const repeated = store.completeReadBack('session-a', request.id, verifiedBooking());
  repeated.bookingId = 'forged';
  assert.deepEqual(await store.submit('session-a', request.id, () => assert.fail('must not book')), verifiedBooking());
  assert.throws(() => store.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
});

test('read-back rejects unverified, forged or mismatched identities and known references', async () => {
  const { store, request } = await unresolved(new BookingStore(), {
    result: { bookingId: 'booking-1', confirmationNumber: 'ABC123' },
  });
  const before = store.getPending('session-a');
  const invalid = [null, {}, { ...verifiedBooking(), verified: false }, { ...verifiedBooking(), verified: 'true' }];
  for (const [field, value] of [
    ['bookingId', 'different-booking'], ['confirmationNumber', 'XYZ789'],
    ['status', 'CANCELLED'], ['paymentStatus', 'PAID'], ['amount', 1], ['currency', 'EUR'],
  ]) invalid.push({ ...verifiedBooking(), [field]: value });
  for (const field of Object.keys(verifiedBooking().flightInfo)) {
    const changed = verifiedBooking();
    changed.flightInfo[field] = 'forged';
    invalid.push(changed);
  }
  for (const changedPassenger of [{ firstName: 'Other', lastName: 'Demo' }, { firstName: 'Alex', lastName: 'Other' }, { ...passenger, email: 'x@example.com' }]) {
    invalid.push({ ...verifiedBooking(), passenger: changedPassenger });
  }
  for (const result of invalid) {
    assert.throws(() => store.completeReadBack('session-a', request.id, result), hasStatus(409));
    assert.deepEqual(store.getPending('session-a'), before);
  }
  assert.throws(() => store.completeReadBack('session-b', request.id, verifiedBooking()), hasStatus(404));
  assert.throws(() => store.completeReadBack('session-a', 'forged', verifiedBooking()), hasStatus(404));
  const awaiting = prepared();
  assert.throws(() => awaiting.store.completeReadBack('session-a', awaiting.request.id, verifiedBooking()), hasStatus(409));
  awaiting.store.approve('session-a', awaiting.request.id);
  assert.throws(() => awaiting.store.completeReadBack('session-a', awaiting.request.id, verifiedBooking()), hasStatus(409));
});

test('local snapshots atomically preserve offers, approval and completed results across restart', async t => {
  const { store, filePath, options } = persistentStore(t);
  store.setOffers('session-a', [offer]);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(filePath)).mode & 0o777, 0o700);
  const initial = readFileSync(filePath, 'utf8');
  const oldFile = openSync(filePath, 'r');
  let request;
  try {
    request = store.prepare('session-a', { offerId: offer.id, passenger });
    assert.equal(readFileSync(oldFile, 'utf8'), initial, 'an old open handle must see the previous complete snapshot');
  } finally {
    closeSync(oldFile);
  }
  const restarted = new BookingStore(options);
  assert.deepEqual(restarted.getOffers('session-a'), [offer]);
  assert.deepEqual(restarted.getPending('session-a'), request);
  restarted.approve('session-a', request.id);
  const approvedRestart = new BookingStore(options);
  assert.equal(approvedRestart.getPending('session-a').status, 'approved');
  let calls = 0;
  await approvedRestart.submit('session-a', request.id, async () => { calls += 1; return verifiedBooking(); });
  const completedRestart = new BookingStore(options);
  assert.equal(completedRestart.getPending('session-a').status, 'completed');
  assert.deepEqual(completedRestart.getBooking('session-a'), verifiedBooking());
  assert.deepEqual(await completedRestart.submit('session-a', request.id, () => assert.fail('must not retry')), verifiedBooking());
  assert.throws(() => completedRestart.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
  assert.equal(calls, 1);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dirname(filePath)), [basename(filePath)]);
});

test('a killed booking process leaves a durable submitting barrier and restarts uncertain, never retryable', async t => {
  const { store, filePath, options } = persistentStore(t);
  const { request } = prepared(store);
  store.approve('session-a', request.id);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { BookingStore } from ${JSON.stringify(new URL('../src/booking-store.mjs', import.meta.url).href)};
    import { readFileSync } from 'node:fs';
    import assert from 'node:assert/strict';
    const store = new BookingStore({ filePath: ${JSON.stringify(filePath)}, now: () => 1_000 });
    await store.submit('session-a', ${JSON.stringify(request.id)}, async () => {
      const saved = JSON.parse(readFileSync(${JSON.stringify(filePath)}, 'utf8'));
      assert.equal(saved.sessions[0][1].pending.status, 'submitting');
      process.kill(process.pid, 'SIGKILL');
    });
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).sessions[0][1].pending.status, 'submitting');
  const recovered = new BookingStore({ ...options, now: () => 10_000_000 });
  assert.equal(recovered.getPending('session-a').status, 'uncertain');
  assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).sessions[0][1].pending.status, 'uncertain');
  await assert.rejects(recovered.submit('session-a', request.id, () => assert.fail('must not retry')), hasStatus(409));
  assert.throws(() => recovered.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
  assert.throws(() => recovered.cancel('session-a', request.id), hasStatus(409));
  recovered.completeReadBack('session-a', request.id, verifiedBooking());
  assert.deepEqual(new BookingStore(options).getBooking('session-a'), verifiedBooking());
});

test('restart expires unsubmitted approvals and preserves cancellations and new-search invalidation', async t => {
  for (const state of ['awaiting_approval', 'approved', 'cancelled', 'new-search']) {
    const { store, filePath, options } = persistentStore(t, { ttlMs: 25 });
    const { request } = prepared(store);
    if (state !== 'awaiting_approval') store.approve('session-a', request.id);
    if (state === 'cancelled') store.cancel('session-a', request.id);
    if (state === 'new-search') store.setOffers('session-a', []);
    const recovered = new BookingStore({ ...options, now: () => 1_025 });
    const expected = ['awaiting_approval', 'approved'].includes(state) ? 'expired' : 'cancelled';
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).sessions[0][1].pending.status, expected);
    assert.equal(recovered.getPending('session-a').status, expected);
    await assert.rejects(recovered.submit('session-a', request.id, () => assert.fail('must not book')), hasStatus(409));
  }
});

test('corrupt or incompatible snapshots are rejected without silently replacing the file', t => {
  const { store, filePath, options } = persistentStore(t);
  const { request } = prepared(store);
  store.approve('session-a', request.id);
  const original = JSON.parse(readFileSync(filePath, 'utf8'));
  const bad = ['', '{', 'null', '{}', '[]', JSON.stringify({ version: 2, sessions: [] }), JSON.stringify({ version: 1, sessions: {} })];
  const corruptions = [
    data => { data.extra = true; },
    data => { data.sessions.push(structuredClone(data.sessions[0])); },
    data => { data.sessions.push(['session-b', structuredClone(data.sessions[0][1])]); },
    data => { data.sessions[0] = ['session-a']; },
    data => { data.sessions[0][0] = 7; },
    data => { data.sessions[0][1].extra = true; },
    data => { data.sessions[0][1].offers = {}; },
    data => { data.sessions[0][1].offers.push(structuredClone(offer)); },
    data => { data.sessions[0][1].offers[0].total = -1; },
    data => { data.sessions[0][1].pending.id = 'forged'; },
    data => { data.sessions[0][1].pending.status = 'paid'; },
    data => { data.sessions[0][1].pending.expiresAt = null; },
    data => { data.sessions[0][1].pending.extra = true; },
    data => { data.sessions[0][1].pending.passenger.email = 'x@example.com'; },
    data => { data.sessions[0][1].pending.passenger.firstName = '<b>Alex'; },
    data => { data.sessions[0][1].pending.offer.total = 1; },
    data => { data.sessions[0][1].pending.offer.id = 'foreign-offer'; },
    data => { data.sessions[0][1].pending.result = { verified: true }; },
    data => { data.sessions[0][1].pending.status = 'completed'; },
    data => { Object.assign(data.sessions[0][1].pending, { status: 'uncertain', result: { verified: true } }); },
  ];
  for (const mutate of corruptions) {
    const data = structuredClone(original);
    mutate(data);
    bad.push(JSON.stringify(data));
  }
  for (const content of bad) {
    writeFileSync(filePath, content);
    assert.throws(() => new BookingStore(options), undefined, content);
    assert.equal(readFileSync(filePath, 'utf8'), content);
  }
});

test('a failed approval or submitting-state write never invokes the booking callback', async t => {
  const { store, filePath, options } = persistentStore(t);
  const { request } = prepared(store);
  let calls = 0;
  const book = async () => { calls += 1; return verifiedBooking(); };
  let restore = blockWrites(filePath);
  try {
    assert.throws(() => store.approve('session-a', request.id));
    assert.equal(store.getPending('session-a').status, 'awaiting_approval');
    await assert.rejects(store.submit('session-a', request.id, book), hasStatus(409));
  } finally { restore(); }
  store.approve('session-a', request.id);
  const approvedSnapshot = readFileSync(filePath, 'utf8');
  restore = blockWrites(filePath);
  try {
    await assert.rejects(store.submit('session-a', request.id, book));
    assert.equal(store.getPending('session-a').status, 'approved');
  } finally { restore(); }
  assert.equal(calls, 0);
  assert.equal(readFileSync(filePath, 'utf8'), approvedSnapshot);
  assert.equal(new BookingStore(options).getPending('session-a').status, 'approved');
  assert.deepEqual(readdirSync(dirname(filePath)), [basename(filePath)]);
});

test('a disk failure after backend execution stays uncertain in memory with known references and cannot retry', async t => {
  for (const throws of [false, true]) {
    const { store, filePath, options } = persistentStore(t);
    const { request } = prepared(store);
    store.approve('session-a', request.id);
    let restore;
    let calls = 0;
    const backendError = Object.assign(new Error('Response was interrupted'), { result: verifiedBooking() });
    try {
      await assert.rejects(store.submit('session-a', request.id, async () => {
        calls += 1;
        restore = blockWrites(filePath);
        if (throws) throw backendError;
        return verifiedBooking();
      }), error => throws ? error === backendError : Boolean(error.code));
      assert.equal(store.getPending('session-a').status, 'uncertain');
      assert.deepEqual(store.getBooking('session-a'), { ...verifiedBooking(), verified: false });
      assert.throws(() => store.prepare('session-a', { offerId: offer.id, passenger }), hasStatus(409));
      await assert.rejects(store.submit('session-a', request.id, () => { calls += 1; }), hasStatus(409));
      assert.equal(calls, 1);
    } finally { restore?.(); }
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).sessions[0][1].pending.status, 'submitting');
    store.completeReadBack('session-a', request.id, verifiedBooking());
    assert.deepEqual(new BookingStore(options).getBooking('session-a'), verifiedBooking());
  }
});

test('invalid or non-serializable callback outcomes remain uncertain and preserve known references', async t => {
  const cyclic = { bookingId: 'booking-1', confirmationNumber: 'ABC123' };
  cyclic.self = cyclic;
  const outcomes = [
    null, undefined, 'BOOKED',
    { bookingId: 'booking-1', confirmationNumber: 'ABC123', verified: false },
    { bookingId: 'booking-1', confirmationNumber: 'ABC123', unsafe: () => {} },
    { bookingId: 'booking-1', confirmationNumber: 'ABC123', unsafe: Infinity },
    cyclic,
  ];
  for (const outcome of outcomes) {
    const { store, options } = persistentStore(t);
    const { request } = prepared(store);
    store.approve('session-a', request.id);
    await assert.rejects(store.submit('session-a', request.id, async () => outcome));
    assert.equal(store.getPending('session-a').status, 'uncertain');
    if (outcome?.bookingId) {
      assert.deepEqual(store.getBooking('session-a'), { bookingId: 'booking-1', confirmationNumber: 'ABC123', verified: false });
    }
    const restarted = new BookingStore(options);
    assert.equal(restarted.getPending('session-a').status, 'uncertain');
    assert.deepEqual(restarted.getBooking('session-a'), store.getBooking('session-a'));
    await assert.rejects(restarted.submit('session-a', request.id, () => assert.fail('must not retry')), hasStatus(409));
  }
  const { store, options } = persistentStore(t);
  const { request } = await unresolved(store, {
    result: { bookingId: undefined, confirmationNumber: 'ABC123', status: 'UNVERIFIED', unsafe: () => {} },
  });
  assert.deepEqual(store.getBooking('session-a'), { confirmationNumber: 'ABC123', status: 'UNVERIFIED', verified: false });
  const restarted = new BookingStore(options);
  assert.deepEqual(restarted.getBooking('session-a'), store.getBooking('session-a'));
  assert.equal(restarted.getPending('session-a').id, request.id);
});

test('invalid search data and session IDs cannot corrupt an existing approval', () => {
  const { store, request } = prepared();
  store.approve('session-a', request.id);
  const before = store.getPending('session-a');
  const badOffers = [
    null, {}, [null], [offer, offer],
    ...[0, -1, NaN, Infinity, '149'].map(total => [{ ...offer, total }]),
    [{ ...offer, id: '' }], [{ ...offer, flightId: '' }], [{ ...offer, currency: 'usd' }],
    [{ ...offer, departureTime: '2027-01-01T10:00:00' }], [{ ...offer, extra: () => {} }],
  ];
  for (const offers of badOffers) {
    assert.throws(() => store.setOffers('session-a', offers), hasStatus(400));
    assert.deepEqual(store.getOffers('session-a'), [offer]);
    assert.deepEqual(store.getPending('session-a'), before);
  }
  for (const sessionId of [null, undefined, '', 1, {}, [], 'a\nb']) {
    assert.throws(() => store.setOffers(sessionId, [offer]), hasStatus(400));
  }
  store.setOffers('session-a', [{ ...offer, fareBrand: undefined }]);
  assert.deepEqual(store.getOffers('session-a'), [offer]);
});

test('invalid store options and clocks are rejected rather than creating non-expiring requests', () => {
  for (const options of [
    null, [], { unknown: true }, { now: 1 }, { filePath: '' }, { filePath: 1 },
    ...[0, -1, NaN, Infinity, '25', 1.5].map(ttlMs => ({ ttlMs })),
    ...[NaN, Infinity, -1, '1000', new Date()].map(value => ({ now: () => value })),
    { now: () => Number.MAX_SAFE_INTEGER, ttlMs: 1 },
  ]) assert.throws(() => new BookingStore(options), hasStatus(400));
  let now = 1_000;
  const { store, request } = prepared(new BookingStore({ now: () => now }));
  now = NaN;
  assert.throws(() => store.approve('session-a', request.id), hasStatus(400));
  now = 1_000;
  assert.equal(store.getPending('session-a').status, 'awaiting_approval');
});

test('read-back requires literal references and serializable exact identity even with no earlier reference', async () => {
  const { store, request } = await unresolved();
  const before = store.getPending('session-a');
  const unsafe = [
    { ...verifiedBooking(), confirmationNumber: 123456 },
    { ...verifiedBooking(), bookingId: '   ' },
    { ...verifiedBooking(), extra: Infinity },
    { ...verifiedBooking(), extra: () => {} },
    { ...verifiedBooking(), flightInfo: { ...verifiedBooking().flightInfo, fareId: 'forged' } },
    { ...verifiedBooking(), flightInfo: { ...verifiedBooking().flightInfo, airlineName: 'Other Air' } },
  ];
  for (const result of unsafe) {
    assert.throws(() => store.completeReadBack('session-a', request.id, result), hasStatus(409));
    assert.deepEqual(store.getPending('session-a'), before);
  }
  assert.deepEqual(store.completeReadBack('session-a', request.id, verifiedBooking()), verifiedBooking());
});

test('a missing booking callback is rejected before changing approval state', async () => {
  const { store, request } = prepared();
  const approved = store.approve('session-a', request.id);
  for (const callback of [null, undefined, {}, 'book']) {
    await assert.rejects(store.submit('session-a', request.id, callback), hasStatus(400));
    assert.deepEqual(store.getPending('session-a'), approved);
  }
});

test('the public store surface and pending schema stay limited to the agreed contract', () => {
  assert.deepEqual(Object.getOwnPropertyNames(BookingStore.prototype).sort(), [
    'constructor', 'setOffers', 'getOffers', 'prepare', 'getPending', 'getBooking',
    'approve', 'enableSilentBug', 'cancel', 'submit', 'completeReadBack', 'beginPayment', 'completePayment', 'failPayment',
  ].sort());
  const { store, request } = prepared();
  assert.deepEqual(Object.keys(request).sort(), ['id', 'status', 'offer', 'passenger', 'expiresAt', 'managerApproval'].sort());
  assert.deepEqual(Object.keys(request.passenger).sort(), ['firstName', 'lastName']);
  assert.equal(store.getPending('missing-session'), null);
  assert.equal(store.getBooking('missing-session'), null);
});

test('restart preserves a known partial reference while demoting submitting results to unverified', async t => {
  const { store, filePath, options } = persistentStore(t);
  const { request } = await unresolved(store, { result: { bookingId: 'booking-1', confirmationNumber: 'ABC123' } });
  const snapshot = JSON.parse(readFileSync(filePath, 'utf8'));
  snapshot.sessions[0][1].pending.status = 'submitting';
  snapshot.sessions[0][1].pending.result.verified = true;
  writeFileSync(filePath, JSON.stringify(snapshot));
  const restarted = new BookingStore(options);
  assert.equal(restarted.getPending('session-a').status, 'uncertain');
  assert.deepEqual(restarted.getBooking('session-a'), { bookingId: 'booking-1', confirmationNumber: 'ABC123', verified: false });
  assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).sessions[0][1].pending.result.verified, false);
  await assert.rejects(restarted.submit('session-a', request.id, () => assert.fail('must not retry')), hasStatus(409));
  assert.throws(() => restarted.completeReadBack('session-a', request.id, { ...verifiedBooking(), confirmationNumber: 'XYZ789' }), hasStatus(409));
  restarted.completeReadBack('session-a', request.id, verifiedBooking());
  assert.deepEqual(new BookingStore(options).getBooking('session-a'), verifiedBooking());
});

test('forged, cross-session and superseded request IDs fail without booking', async () => {
  const { store, request } = prepared();
  prepared(store, 'session-b');
  let calls = 0;
  const book = async () => { calls += 1; };
  for (const [sessionId, requestId] of [
    ['session-a', 'forged-id'], ['session-b', request.id], ['missing-session', request.id],
  ]) {
    assert.throws(() => store.approve(sessionId, requestId), hasStatus(404));
    await assert.rejects(store.submit(sessionId, requestId, book), hasStatus(404));
  }
  const replacement = store.prepare('session-a', { offerId: offer.id, passenger });
  assert.notEqual(replacement.id, request.id);
  assert.throws(() => store.approve('session-a', request.id), hasStatus(404));
  await assert.rejects(store.submit('session-a', request.id, book), hasStatus(404));
  assert.equal(calls, 0);
});
