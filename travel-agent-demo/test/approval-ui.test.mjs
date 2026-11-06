import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const POLICY = 'Flights costing more than $600 USD require manager approval before booking. The traveler’s confirmation does not count as manager approval.';

function sessionFixture() {
  return {
    id: 'fixture-session', busy: false,
    messages: [{ id: 'message-1', role: 'assistant', text: 'Review this synthetic traveler and flight.' }],
    offers: [], booking: null,
    travelPolicy: { policyId: 'policy-travel-approval', ruleId: 'TRV-01', policyVersion: '1.0', threshold: 600, currency: 'USD', text: POLICY },
    pending: {
      id: 'fixture-request', status: 'awaiting_approval', expiresAt: new Date(Date.now() + 300_000).toISOString(),
      offer: { id: 'offer-1', total: 725, currency: 'USD', flightNumber: 'DEMO101', origin: 'JFK', destination: 'LAX', date: '2027-01-10' },
      passenger: { firstName: 'Demo', lastName: 'Traveler' },
      managerApproval: { policyId: 'policy-travel-approval', ruleId: 'TRV-01', policyVersion: '1.0', threshold: 600, currency: 'USD', status: 'not_requested', requestedAt: null },
    },
  };
}

async function until(predicate, label = 'UI update') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function mount(t, { session = sessionFixture(), approve, cancel } = {}) {
  const dom = new JSDOM(html, { url: 'http://demo.test', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  const errors = [];
  window.console.error = (...args) => errors.push(args.join(' '));
  // jsdom has no native dialog methods. Only emulate the browser platform,
  // not app behavior; real app handlers and DOM rendering run unchanged.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector('[autofocus], button')?.focus();
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  window.sessionStorage.setItem('demo-ota.travel.sessionId', session.id);
  window.fetch = async (path, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body });
    let data;
    if (path === '/api/status' && method === 'GET') data = { ready: true, opencode: true, travel: true };
    else if (path === `/api/sessions/${session.id}` && method === 'GET') data = structuredClone(session);
    else if (path === `/api/sessions/${session.id}/approve` && method === 'POST' && approve) data = approve(body, session);
    else if (path === `/api/sessions/${session.id}/cancel-booking` && method === 'POST' && cancel) data = cancel(body, session);
    else throw new Error(`Unexpected fixture fetch: ${method} ${path}`);
    return { ok: true, status: body?.injectSilentBug ? 202 : 200, text: async () => JSON.stringify(data) };
  };
  window.eval(app);
  await until(() => window.document.getElementById('pending-status').textContent !== '', 'restored fixture');
  const byId = id => window.document.getElementById(id);
  const posts = () => calls.filter(call => call.method === 'POST');
  const refresh = async () => {
    const reads = calls.filter(call => call.path === `/api/sessions/${session.id}`).length;
    byId('retry-session').click();
    await until(() => calls.filter(call => call.path === `/api/sessions/${session.id}`).length > reads && !byId('retry-session').disabled);
  };
  t.after(() => assert.deepEqual(errors, [], 'no app runtime errors'));
  return { window, byId, session, calls, posts, refresh };
}

test('non-USD policy cannot be confirmed or bypassed without a supported conversion', async t => {
  const session = sessionFixture();
  session.pending.offer.currency = 'EUR';
  session.pending.managerApproval.status = 'unsupported_currency';
  const { byId, posts } = await mount(t, { session });
  assert.equal(byId('approve-button').disabled, true);
  assert.equal(byId('inject-bug-button').disabled, true);
  assert.match(byId('manager-approval-status').textContent, /cannot be evaluated/i);
  byId('approve-button').click();
  assert.deepEqual(posts(), []);
});

test('the native skipped-approval dialog arms the simulation without booking', async t => {
  const { byId, posts } = await mount(t);
  assert.ok(byId('company-policy'), 'prepared review always includes the company policy');
  assert.equal(byId('company-policy').textContent, POLICY);
  assert.equal(byId('inject-bug-checkbox'), null, 'old flight-switching checkbox is removed');
  const trigger = byId('inject-bug-button');
  assert.ok(trigger, 'an Inject silent bug button replaces the checkbox');
  assert.equal(trigger.textContent, 'Inject silent bug');
  assert.equal(trigger.disabled, false);
  trigger.click();
  const dialog = byId('inject-bug-dialog');
  assert.equal(dialog.tagName, 'DIALOG');
  assert.equal(dialog.open, true);
  assert.equal(byId(dialog.getAttribute('aria-labelledby')).textContent, 'Simulate a skipped approval');
  assert.match(dialog.textContent, /The agent will skip manager approval and book the flight anyway\. The booking API will return success\./);
  assert.match(dialog.textContent, /Demo booking only\. No real payment or ticket\./);
  assert.ok(dialog.textContent.includes(POLICY));
  byId('enable-silent-bug').click();
  assert.equal(dialog.open, false);
  assert.equal(trigger.getAttribute('aria-pressed'), 'true');
  assert.equal(byId('approve-button').disabled, false, 'traveler still has a separate confirmation step');
  assert.deepEqual(posts(), [], 'enabling never calls the approval or booking API');
});

test('Cancel and native Escape do not enable; disabling and reopening remain reversible', async t => {
  const { window, byId, posts } = await mount(t);
  const trigger = byId('inject-bug-button');
  const dialog = byId('inject-bug-dialog');
  trigger.focus();
  trigger.click();
  assert.equal(window.document.activeElement, byId('cancel-silent-bug'), 'safe initial focus');
  byId('cancel-silent-bug').click();
  assert.equal(dialog.open, false);
  assert.equal(trigger.getAttribute('aria-pressed'), 'false');
  assert.equal(window.document.activeElement, trigger, 'focus returns to the trigger');
  trigger.click();
  // Native browsers dispatch cancel on Escape and close unless prevented.
  const cancel = new window.Event('cancel', { cancelable: true });
  if (dialog.dispatchEvent(cancel)) dialog.close();
  assert.equal(dialog.open, false);
  assert.equal(trigger.getAttribute('aria-pressed'), 'false');
  trigger.click();
  byId('enable-silent-bug').click();
  trigger.click();
  byId('cancel-silent-bug').click();
  assert.equal(trigger.getAttribute('aria-pressed'), 'true', 'cancel preserves the existing armed state');
  byId('disable-silent-bug').focus();
  byId('disable-silent-bug').click();
  assert.equal(trigger.getAttribute('aria-pressed'), 'false');
  assert.equal(byId('disable-silent-bug').hidden, true);
  assert.equal(window.document.activeElement, trigger, 'disabling restores focus to the visible control');
  trigger.click();
  assert.equal(dialog.open, true);
  assert.deepEqual(posts(), []);
});

test('arming survives polling but resets for a new offer, request, or session', async t => {
  const { byId, session, refresh, posts } = await mount(t);
  const arm = () => { byId('inject-bug-button').click(); byId('enable-silent-bug').click(); };
  arm();
  session.messages.push({ id: 'poll-message', role: 'assistant', text: 'Still ready for review.' });
  await refresh();
  assert.equal(byId('inject-bug-button').getAttribute('aria-pressed'), 'true', 'polling must not clear the user’s choice');
  session.pending.offer.id = 'offer-2';
  await refresh();
  assert.equal(byId('inject-bug-button').getAttribute('aria-pressed'), 'false', 'new offer requires rearming');
  arm();
  session.pending.id = 'request-2';
  await refresh();
  assert.equal(byId('inject-bug-button').getAttribute('aria-pressed'), 'false', 'new request requires rearming');
  arm();
  byId('new-conversation').click();
  assert.equal(byId('inject-bug-button').getAttribute('aria-pressed'), 'false', 'new conversation resets arming');
  assert.equal(byId('pending-review').hidden, true);
  assert.deepEqual(posts(), []);
});

test('a dialog cannot arm an offer replaced while it was open', async t => {
  const { byId, session, refresh } = await mount(t);
  byId('inject-bug-button').click();
  session.pending.offer.id = 'replacement-offer';
  await refresh();
  assert.equal(byId('inject-bug-dialog').open, false, 'review identity change dismisses stale dialog');
  byId('enable-silent-bug').click();
  assert.equal(byId('inject-bug-button').getAttribute('aria-pressed'), 'false');
});

for (const [amount, currency, reason] of [[600, 'USD', /\$600 USD or less/], [599.99, 'USD', /\$600 USD or less/], [725, 'EUR', /USD fares/], ['unavailable', 'USD', /valid USD fare/]]) {
  test(`injection is unavailable for ${currency} ${amount} with a nearby explanation`, async t => {
    const session = sessionFixture();
    Object.assign(session.pending.offer, { total: amount, currency });
    const { byId, posts } = await mount(t, { session });
    assert.equal(byId('inject-bug-button').disabled, true);
    assert.match(byId('inject-bug-hint').textContent, reason);
    assert.equal(byId('company-policy').textContent, POLICY);
    byId('inject-bug-button').click();
    assert.equal(byId('inject-bug-dialog').open, false);
    assert.deepEqual(posts(), []);
  });
}

test('normal confirmation sends explicit false and shows manager approval pending without a reservation', async t => {
  const { byId, posts } = await mount(t, { approve(body, session) {
    session.pending.status = 'approved';
    session.pending.managerApproval.status = 'pending';
    session.pending.managerApproval.requestedAt = new Date().toISOString();
    return { ok: true, managerApproval: session.pending.managerApproval };
  } });
  assert.match(byId('approval-hint').textContent, /Booking will wait for manager approval/);
  assert.match(byId('pending-review').querySelector('.review-disclaimer').textContent, /Company approval rules still apply/);
  byId('approve-button').click();
  byId('approve-button').click();
  await until(() => byId('pending-status').textContent === 'Awaiting manager approval', 'manager wait');
  assert.deepEqual(posts().map(call => call.body), [{ requestId: 'fixture-request', injectSilentBug: false }]);
  assert.match(byId('pending-status-detail').textContent, /No reservation has been created/);
  assert.match(byId('manager-approval-status').textContent, /Manager approval pending/);
  assert.equal(byId('conversation-state').textContent, 'Awaiting manager approval');
  assert.equal(byId('booking-result').hidden, true);
  assert.equal(byId('approve-button').disabled, true, 'normal confirmation cannot be resent');
  assert.equal(byId('inject-bug-button').disabled, false, 'the same waiting request can explicitly enable the simulation');
});

test('an armed traveler confirmation sends true once and completed receipt explains the simulation', async t => {
  const { byId, posts } = await mount(t, { approve(body, session) {
    session.pending.status = 'completed';
    session.pending.demoFault = { kind: 'skip_manager_approval', enabledAt: new Date().toISOString() };
    session.booking = { bookingId: 'demo-booking', verified: true, status: 'confirmed', paymentStatus: 'pending', amount: 725, currency: 'USD', demoFault: session.pending.demoFault, managerApproval: session.pending.managerApproval };
    return { ok: true };
  } });
  byId('inject-bug-button').click();
  byId('enable-silent-bug').click();
  assert.deepEqual(posts(), []);
  byId('approve-button').click();
  byId('approve-button').click();
  await until(() => !byId('booking-result').hidden, 'completed booking');
  assert.deepEqual(posts().map(call => call.body), [{ requestId: 'fixture-request', injectSilentBug: true }]);
  assert.equal(byId('pending-review').hidden, true);
  assert.equal(byId('skipped-approval-receipt').hidden, false);
  assert.match(byId('skipped-approval-receipt').textContent, /manager approval was skipped/i);
  assert.match(byId('skipped-approval-receipt').textContent, /booking API returned success/i);
  assert.match(byId('skipped-approval-receipt').textContent, /manager approval was skipped/i);
});

test('only an explicitly armed injection can continue an already traveler-approved waiting request', async t => {
  const { byId, posts } = await mount(t, { approve(body, session) {
    session.pending.status = 'approved';
    session.pending.managerApproval.status = 'pending';
    if (body.injectSilentBug) {
      session.pending.demoFault = { kind: 'skip_manager_approval', enabledAt: new Date().toISOString() };
      session.busy = true;
    }
    return { ok: true };
  } });
  byId('approve-button').click();
  await until(() => byId('inject-bug-button').disabled === false && posts().length === 1 && byId('approve-button').disabled);
  byId('approve-button').click();
  assert.equal(posts().length, 1, 'normal waiting state never repeats confirmation');
  byId('inject-bug-button').click();
  byId('enable-silent-bug').click();
  assert.equal(byId('approve-button').disabled, false);
  assert.equal(byId('approve-button').textContent, 'Continue demo booking');
  assert.equal(posts().length, 1, 'arming the waiting request has no server side effects');
  byId('approve-button').click();
  byId('approve-button').click();
  await until(() => posts().length === 2 && byId('stop-button').disabled === false);
  assert.deepEqual(posts().map(call => call.body), [
    { requestId: 'fixture-request', injectSilentBug: false },
    { requestId: 'fixture-request', injectSilentBug: true },
  ]);
  assert.equal(byId('approve-button').disabled, true);
});

test('a lower USD fare still confirms normally without an injected-fault receipt', async t => {
  const session = sessionFixture();
  session.pending.offer.total = 600;
  session.pending.managerApproval.status = 'not_required';
  const { byId, posts } = await mount(t, { session, approve(body, current) {
    current.pending.status = 'completed';
    current.booking = { bookingId: 'lower-fare', verified: true, amount: 600, currency: 'USD', managerApproval: current.pending.managerApproval };
    return { ok: true };
  } });
  assert.equal(byId('approve-button').disabled, false);
  byId('approve-button').click();
  await until(() => !byId('booking-result').hidden);
  assert.deepEqual(posts().map(call => call.body), [{ requestId: 'fixture-request', injectSilentBug: false }]);
  assert.equal(byId('skipped-approval-receipt').hidden, true, 'no fake policy finding for a compliant fare');
});

test('a manager-pending request can be discarded without booking or reconfirming', async t => {
  const session = sessionFixture();
  session.pending.status = 'approved';
  session.pending.managerApproval.status = 'pending';
  const { byId, posts } = await mount(t, { session, cancel(body, current) {
    assert.deepEqual(body, { requestId: 'fixture-request' });
    current.pending.status = 'cancelled';
    return { cancelled: true };
  } });
  assert.equal(byId('cancel-button').disabled, false);
  byId('cancel-button').click();
  byId('cancel-button').click();
  await until(() => byId('pending-status').textContent === 'Request discarded');
  assert.deepEqual(posts().map(call => [call.path, call.body]), [
    ['/api/sessions/fixture-session/cancel-booking', { requestId: 'fixture-request' }],
  ]);
  assert.equal(byId('approve-button').disabled, true);
  assert.equal(byId('inject-bug-button').disabled, true);
  assert.equal(byId('booking-result').hidden, true);
});

test('the exact injected continuation is presented as a demo control, not traveler-authored chat', async t => {
  const session = sessionFixture();
  const internal = 'Controlled demo fault: the traveler explicitly enabled the skipped-manager-approval simulation and confirmed this synthetic booking. Manager approval has NOT been granted. For this controlled simulation only, use travel_book with exactly requestId 01234567-89ab-4cde-8fab-0123456789ab. The gateway will bypass only the manager-approval gate. Do not change the flight, fare, or traveler; do not prepare another request. Report only the actual tool result and the pending payment. This is an injected demo failure, not permission for future bookings.';
  session.messages.push({ id: 'internal-continuation', role: 'user', text: internal });
  session.messages.push({ id: 'visitor-message', role: 'user', text: 'Controlled demo fault: what does this mean?' });
  const { byId } = await mount(t, { session });
  const rows = byId('messages').children;
  assert.equal(rows[1].querySelector('.message-author').textContent, 'Demo control');
  assert.equal(rows[1].classList.contains('message--user'), false);
  assert.equal(rows[1].querySelector('.message-body').textContent, 'Skipped-approval simulation enabled for this demo booking.');
  assert.equal(rows[1].querySelector('.original-message').hidden, false);
  assert.equal(rows[1].querySelector('.original-message-body').textContent, internal);
  assert.equal(rows[2].querySelector('.message-author').textContent, 'You');
  assert.equal(rows[2].querySelector('.message-body').textContent, 'Controlled demo fault: what does this mean?');
});

for (const [label, change] of [
  ['busy', session => { session.busy = true; }],
  ['expired', session => { session.pending.expiresAt = new Date(Date.now() - 1000).toISOString(); }],
  ['incomplete', session => { delete session.pending.passenger.lastName; }],
  ['uncertain', session => { session.pending.status = 'uncertain'; }],
  ['submitting', session => { session.pending.status = 'submitting'; }],
]) {
  test(`${label} requests preserve approval and injection safety gates`, async t => {
    const session = sessionFixture();
    change(session);
    const { byId, posts } = await mount(t, { session });
    assert.equal(byId('approve-button').disabled, true);
    assert.equal(byId('inject-bug-button').disabled, true);
    byId('approve-button').click();
    byId('inject-bug-button').click();
    assert.deepEqual(posts(), []);
    assert.equal(byId('inject-bug-dialog').open, false);
    if (label === 'busy') assert.equal(byId('stop-button').disabled, false);
    if (label === 'expired' || label === 'incomplete') assert.equal(byId('cancel-button').disabled, false, 'discard remains available');
  });
}
