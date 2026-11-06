import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BookingStore } from '../src/booking-store.mjs';

const offer = { id: 'offer-manager', flightId: 'flight-manager', fareId: 'fare-manager', origin: 'CDG', destination: 'IST', date: '2026-11-15', flightNumber: 'DEMO101', departureTime: '2026-11-15T10:00:00', arrivalTime: '2026-11-15T13:30:00', cabinClass: 'ECONOMY', airlineName: 'Demo Air', total: 1250, currency: 'USD' };
const passenger = { firstName: 'Alex', lastName: 'Demo' };
function prepare(total = 1250, currency = 'USD', store = new BookingStore()) {
  store.setOffers('ses_policy', [{ ...offer, total, currency }]);
  const pending = store.prepare('ses_policy', { offerId: offer.id, passenger });
  return { store, pending };
}
function booking(request) {
  return { bookingId: 'booking-policy', confirmationNumber: 'ABC123', status: 'CONFIRMED', paymentStatus: 'PENDING', verified: true, amount: request.offer.total, currency: request.offer.currency, passenger,
    flightInfo: { flightId: offer.flightId, flightNumber: offer.flightNumber, departureAirport: offer.origin, arrivalAirport: offer.destination, departureTime: offer.departureTime, arrivalTime: offer.arrivalTime, cabinClass: offer.cabinClass } };
}

test('policy is attached before booking and traveler confirmation requests, not grants, manager approval', async () => {
  const { store, pending } = prepare();
  assert.equal(pending.managerApproval?.status, 'not_requested');
  assert.equal(pending.managerApproval.threshold, 1000);
  assert.equal(pending.managerApproval.policyVersion, '1.1');
  assert.equal(pending.managerApproval.policyId, 'policy-travel-approval');
  const confirmed = store.approve('ses_policy', pending.id);
  assert.equal(confirmed.status, 'approved');
  assert.equal(confirmed.managerApproval.status, 'pending');
  assert.ok(confirmed.managerApproval.requestedAt);
  let calls = 0;
  await assert.rejects(store.submit('ses_policy', pending.id, async request => { calls++; return booking(request); }), /manager approval/i);
  assert.equal(calls, 0);
  assert.equal(store.getBooking('ses_policy'), null);
});

test('explicit demo fault skips manager approval without changing the selected flight and preserves evidence', async () => {
  const { store, pending } = prepare();
  assert.equal(typeof store.enableSilentBug, 'function');
  const enabled = store.enableSilentBug('ses_policy', pending.id);
  assert.equal(enabled.demoFault.kind, 'skip_manager_approval');
  const approved = store.approve('ses_policy', pending.id);
  assert.equal(approved.managerApproval.status, 'not_requested');
  let calls = 0;
  const result = await store.submit('ses_policy', pending.id, async request => { calls++; assert.equal(request.offer.id, offer.id); return booking(request); });
  assert.equal(result.managerApproval.status, 'not_requested');
  assert.equal(result.demoFault.kind, 'skip_manager_approval');
  assert.equal(result.amount, 1250);
  assert.equal(calls, 1);
  assert.deepEqual(await store.submit('ses_policy', pending.id, async () => { throw new Error('Must not repeat booking'); }), result);
});

test('browser approval and fault arming are one atomic store transition with an explicit per-confirmation flag', async () => {
  const { store, pending } = prepare();
  const confirmed = store.approve('ses_policy', pending.id, { injectSilentBug: true });
  assert.equal(confirmed.managerApproval.status, 'not_requested');
  assert.equal(confirmed.demoFault.kind, 'skip_manager_approval');
  const result = await store.submit('ses_policy', pending.id, async request => booking(request));
  assert.equal(result.demoFault.kind, 'skip_manager_approval');

  const second = prepare();
  second.store.enableSilentBug('ses_policy', second.pending.id);
  const disabled = second.store.approve('ses_policy', second.pending.id, { injectSilentBug: false });
  assert.equal(disabled.demoFault, undefined);
  assert.equal(disabled.managerApproval.status, 'pending');
  await assert.rejects(second.store.submit('ses_policy', second.pending.id, async request => booking(request)), /manager approval/i);
});

test('USD boundary and unsupported currencies fail closed without fabricating conversion', async () => {
  for (const [total, currency, expected] of [[999, 'USD', 'not_required'], [1000, 'USD', 'not_required'], [1000.01, 'USD', 'pending'], [1250, 'EUR', 'unsupported_currency']]) {
    const { store, pending } = prepare(total, currency);
    const approved = store.approve('ses_policy', pending.id);
    assert.equal(approved.managerApproval.status, expected);
    let calls = 0;
    const submit = () => store.submit('ses_policy', pending.id, async request => { calls++; return booking(request); });
    if (expected === 'not_required') await submit();
    else await assert.rejects(submit(), /manager approval/i);
    assert.equal(calls, expected === 'not_required' ? 1 : 0);
    if (total <= 1000 || currency !== 'USD') assert.throws(() => store.enableSilentBug('ses_policy', pending.id), /above \$1,000 USD/i);
  }
});

test('saved requests retain their original approval policy while new requests use the raised limit', async t => {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'manager-policy-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'bookings.json');
  const { store, pending } = prepare(750, 'USD', new BookingStore({ filePath }));
  store.approve('ses_policy', pending.id);
  const snapshot = JSON.parse(readFileSync(filePath, 'utf8'));
  const priorApproval = snapshot.sessions[0][1].pending.managerApproval;
  Object.assign(priorApproval, {
    policyVersion: '1.0', threshold: 600, status: 'pending', requestedAt: new Date().toISOString(),
  });
  writeFileSync(filePath, JSON.stringify(snapshot));

  const restored = new BookingStore({ filePath });
  assert.equal(restored.getPending('ses_policy').managerApproval.policyVersion, '1.0');
  assert.equal(restored.getPending('ses_policy').managerApproval.status, 'pending');
  assert.equal(restored.getPending('ses_policy').managerApproval.threshold, 600);
  await assert.rejects(restored.submit('ses_policy', pending.id, async () => booking(pending)), /manager approval/i);

  restored.setOffers('ses_new', [{ ...offer, total: 750 }]);
  const current = restored.prepare('ses_new', { offerId: offer.id, passenger });
  assert.equal(current.managerApproval.policyVersion, '1.1');
  assert.equal(current.managerApproval.threshold, 1000);
  assert.equal(current.managerApproval.status, 'not_required');
});

test('manager-waiting requests can be cancelled without creating a booking', () => {
  const { store, pending } = prepare();
  store.approve('ses_policy', pending.id);
  assert.equal(store.cancel('ses_policy', pending.id).status, 'cancelled');
  assert.throws(() => store.enableSilentBug('ses_policy', pending.id), /active flight review/i);
});

test('verified read-back after an uncertain injected booking retains the approval evidence', async () => {
  const { store, pending } = prepare();
  store.enableSilentBug('ses_policy', pending.id);
  store.approve('ses_policy', pending.id);
  await assert.rejects(store.submit('ses_policy', pending.id, async () => { throw new Error('Timeout'); }), /Timeout/);
  assert.equal(store.getBooking('ses_policy'), null);
  const result = store.completeReadBack('ses_policy', pending.id, booking(pending));
  assert.equal(result.managerApproval.status, 'not_requested');
  assert.equal(result.demoFault.kind, 'skip_manager_approval');
});

test('injection is request-local, expires normally, and cannot be enabled across sessions', async () => {
  let now = 1000;
  const { store, pending } = prepare(1250, 'USD', new BookingStore({ now: () => now, ttlMs: 100 }));
  assert.throws(() => store.enableSilentBug('ses_other', pending.id), /not found/i);
  store.enableSilentBug('ses_policy', pending.id);
  now = 1101;
  assert.throws(() => store.approve('ses_policy', pending.id), error => error.statusCode === 409);
  assert.equal(store.getPending('ses_policy').status, 'expired');
  const next = store.prepare('ses_policy', { offerId: offer.id, passenger });
  assert.equal(next.demoFault, undefined);
  store.approve('ses_policy', next.id);
  await assert.rejects(store.submit('ses_policy', next.id, async request => booking(request)), /manager approval/i);
});

test('restart preserves explicit approval evidence and historical records are not retroactively marked injected', async t => {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'manager-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'bookings.json');
  const { store, pending } = prepare(1250, 'USD', new BookingStore({ filePath }));
  store.enableSilentBug('ses_policy', pending.id);
  store.approve('ses_policy', pending.id);
  const result = await store.submit('ses_policy', pending.id, async request => booking(request));
  assert.deepEqual(new BookingStore({ filePath }).getBooking('ses_policy'), result);
  const validSnapshot = readFileSync(filePath, 'utf8');
  for (const tamper of [
    value => { value.managerApproval.status = 'approved'; },
    value => { value.demoFault.kind = 'different_fault'; },
    value => { delete value.managerApproval; delete value.demoFault; },
  ]) {
    const corrupted = JSON.parse(validSnapshot);
    tamper(corrupted.sessions[0][1].pending.result);
    writeFileSync(filePath, JSON.stringify(corrupted));
    assert.throws(() => new BookingStore({ filePath }), /Invalid booking store state/i);
  }
  writeFileSync(filePath, validSnapshot);
  const snapshot = JSON.parse(readFileSync(filePath, 'utf8'));
  const request = snapshot.sessions[0][1].pending;
  delete request.managerApproval;
  delete request.demoFault;
  delete request.result.managerApproval;
  delete request.result.demoFault;
  writeFileSync(filePath, JSON.stringify(snapshot));
  assert.equal(new BookingStore({ filePath }).getBooking('ses_policy').demoFault, undefined);
});

test('a failed atomic confirmation cannot leave an armed fault behind for a later normal confirmation', async t => {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, 'manager-policy-write-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const filePath = join(root, 'bookings.json');
  const { store, pending } = prepare(1250, 'USD', new BookingStore({ filePath }));
  renameSync(filePath, `${filePath}.saved`);
  mkdirSync(filePath);
  try {
    assert.throws(() => store.approve('ses_policy', pending.id, { injectSilentBug: true }));
    assert.deepEqual(store.getPending('ses_policy'), pending);
  } finally {
    rmSync(filePath, { recursive: true });
    renameSync(`${filePath}.saved`, filePath);
  }
  const normal = store.approve('ses_policy', pending.id, { injectSilentBug: false });
  assert.equal(normal.demoFault, undefined);
  assert.equal(normal.managerApproval.status, 'pending');
  await assert.rejects(store.submit('ses_policy', pending.id, async request => booking(request)), /manager approval/i);
});
