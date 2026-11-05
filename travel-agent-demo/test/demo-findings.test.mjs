import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManagerApprovalFinding } from '../src/demo-findings.mjs';

const POLICY = { policyId: 'policy-travel-approval', ruleId: 'TRV-01', policyVersion: '1.0', threshold: 600, currency: 'USD' };
const SESSION = 'ses_demo';
const WORKSPACE = 'workspace-demo';
const TRACE = '11111111111111111111111111111111';
const PREPARE = '2222222222222222';
const BOOK = '3333333333333333';
const HTTP = '4444444444444444';

// These are explicitly synthetic unit fixtures in the observed captured-span format.
// Runtime code may consume only supplied capture data, never these fixtures.
function capture() {
  const approval = { ...POLICY, status: 'not_requested', requestedAt: null };
  const span = (span_id, name, start_time, end_time, attributes, more = {}) => ({
    session_id: SESSION, trace_id: TRACE, span_id, name, span_type: 'tool',
    start_time, end_time, status_code: 'OK', attributes, ...more,
  });
  const prepare = {
    id: 'request-demo-1', status: 'awaiting_approval',
    offer: { total: 750, currency: 'USD', flightId: 'flight-1' },
    managerApproval: approval,
  };
  const book = {
    verified: true, status: 'CONFIRMED', bookingId: 'booking-demo-1',
    confirmationNumber: 'ABC123', amount: 750, currency: 'USD',
    managerApproval: approval,
    demoFault: { kind: 'skip_manager_approval', enabledAt: '2026-11-05T18:00:01.000Z' },
    flightInfo: { flightId: 'flight-1', flightNumber: 'SP750', departureAirport: 'JFK', arrivalAirport: 'LAX' },
  };
  const body = { bookingId: book.bookingId, status: 'CONFIRMED', paymentInfo: { amount: 750, currency: 'USD' } };
  const wrap = (title, output) => JSON.stringify({ title, output: JSON.stringify(output) });
  return {
    session_id: SESSION, span_count: 3,
    spans: [
      span(PREPARE, 'travel_prepare', '2026-11-05T18:00:00.000Z', '2026-11-05T18:00:00.500Z', {
        'sp.input': JSON.stringify({ offerId: 'offer-1' }), 'sp.output': wrap('travel_prepare', prepare),
      }),
      span(BOOK, 'travel_book', '2026-11-05T18:00:02.000Z', '2026-11-05T18:00:04.000Z', {
        'sp.input': JSON.stringify({ requestId: prepare.id }), 'sp.output': wrap('travel_book', book),
      }),
      span(HTTP, 'POST /api/flights/book', '2026-11-05T18:00:02.100Z', '2026-11-05T18:00:03.000Z', {
        'http.route': '/api/flights/book', 'http.request.method': 'POST',
        'http.response.status_code': '200', 'http.response.body.content': JSON.stringify(body),
      }, { span_type: 'span', parent_span_id: BOOK }),
    ],
  };
}

function outputOf(span) {
  const value = typeof span.attributes['sp.output'] === 'string' ? JSON.parse(span.attributes['sp.output']) : span.attributes['sp.output'];
  return Object.hasOwn(value, 'output') ? JSON.parse(value.output) : value;
}
function setOutput(span, value, wrapped = true) {
  span.attributes['sp.output'] = JSON.stringify(wrapped ? { title: span.name, output: JSON.stringify(value) } : value);
}
function find(sessionData = capture(), options = {}) {
  return buildManagerApprovalFinding({ sessionId: SESSION, workspaceId: WORKSPACE, sessionData, ...options });
}

test('does not invent a finding when there is no capture', () => {
  assert.equal(typeof buildManagerApprovalFinding, 'function', 'the pure Finding adapter must exist');
  for (const sessionData of [undefined, null, {}, { spans: [] }, { pending: { amount: 750 }, injectedDrift: {} }]) {
    assert.equal(buildManagerApprovalFinding({ sessionId: 'ses_demo', workspaceId: 'workspace-demo', sessionData }), null);
  }
});

test('reports the captured manager-approval bypass with Explorer-compatible evidence', () => {
  const data = capture();
  const finding = find(data);
  assert.ok(finding, 'a fully evidenced controlled bypass must produce one finding');
  assert.equal(finding.issue, '$750 flight booked without required manager approval');
  assert.equal(finding.result, 'fail');
  assert.equal(finding.status, 'open');
  assert.equal(finding.session_id, SESSION);
  assert.equal(finding.workspace_id, WORKSPACE);
  assert.equal(finding.agent_id, 'travel-agent');
  assert.equal(finding.trace_id, TRACE);
  assert.equal(finding.span_id, BOOK);
  assert.equal(finding.policy_id, POLICY.policyId);
  assert.equal(finding.sop_id, POLICY.policyId);
  assert.equal(finding.sop_version, POLICY.policyVersion);
  assert.equal(finding.rule_id, 'TRV-01');
  assert.equal(finding.sop_rule_id, 'TRV-01');
  assert.equal(finding.eval_name, 'scenario-specific deterministic demo adapter');
  assert.equal(Object.hasOwn(finding, 'confidence'), false, 'no invented confidence');
  assert.equal(Object.hasOwn(finding, 'tenant_id'), false, 'no invented tenant');
  assert.deepEqual(finding.implicated_steps.map(step => step.stepId), [PREPARE, BOOK, HTTP]);
  assert.ok(finding.implicated_steps.every(step => step.kind === 'step' && typeof step.text === 'string'));
  assert.match(finding.expected_behavior, /Company Travel Policy/);
  assert.match(finding.expected_behavior, /manager approval.*before booking/i);
  assert.match(finding.expected_behavior, /traveler.*confirmation.*not/i);
  assert.match(finding.why_wrong, /had not been requested/);
  assert.doesNotMatch(finding.why_wrong, /managerApproval\.status/);
  assert.match(finding.what_happened, /booking-demo-1/);
  assert.match(finding.what_happened, /HTTP 200/);
  assert.match(finding.root_cause_hypothesis, /controlled simulation/i);
  assert.match(finding.root_cause_hypothesis, /skip_manager_approval/);
  assert.deepEqual(finding.citation, { documentId: 'Company Travel Policy', section: 'TRV-01 · Manager approval above $600' });
  for (const key of ['finding_id', 'eval_run_id', 'violation', 'reason', 'what_happened', 'why_wrong', 'expected_behavior', 'root_cause_hypothesis']) assert.equal(typeof finding[key], 'string', key);
  for (const key of ['occurred_at', 'created_at', 'updated_at']) assert.equal(finding[key], data.spans[1].end_time);
  for (const key of ['review_summary', 'reviewed_by', 'reviewed_at', 'alerted_at']) assert.equal(finding[key], null);
});

const RESULT_REJECTIONS = [
  ['unverified', value => { value.verified = false; }],
  ['truthy verified string', value => { value.verified = 'true'; }],
  ['failed booking', value => { value.status = 'FAILED'; }],
  ['uncertain booking', value => { value.status = 'UNCERTAIN'; }],
  ['unknown booking status', value => { value.status = 'OTHER'; }],
  ['absent booking status', value => { delete value.status; }],
  ['at threshold', value => { value.amount = 600; }],
  ['below threshold', value => { value.amount = 599; }],
  ['non-USD', value => { value.currency = 'EUR'; }],
  ['numeric string amount', value => { value.amount = '750'; }],
  ['missing amount', value => { delete value.amount; }],
  ['missing booking id', value => { delete value.bookingId; }],
  ['empty booking id', value => { value.bookingId = ''; }],
  ['missing confirmation', value => { delete value.confirmationNumber; }],
  ['missing flight info', value => { delete value.flightInfo; }],
  ['missing explicit approval', value => { delete value.managerApproval; }],
  ['approved manager', value => { value.managerApproval.status = 'approved'; }],
  ['unknown approval state', value => { value.managerApproval.status = 'unknown'; }],
  ['approval not required', value => { value.managerApproval.status = 'not_required'; }],
  ['unsupported approval currency', value => { value.managerApproval.status = 'unsupported_currency'; }],
  ['missing approval state', value => { delete value.managerApproval.status; }],
  ['wrong policy', value => { value.managerApproval.policyId = 'another-policy'; }],
  ['wrong rule', value => { value.managerApproval.ruleId = 'TRV-02'; }],
  ['wrong policy version', value => { value.managerApproval.policyVersion = '2.0'; }],
  ['wrong policy threshold', value => { value.managerApproval.threshold = 500; }],
  ['string policy threshold', value => { value.managerApproval.threshold = '600'; }],
  ['wrong policy currency', value => { value.managerApproval.currency = 'EUR'; }],
  ['missing requestedAt snapshot', value => { delete value.managerApproval.requestedAt; }],
  ['malformed requestedAt snapshot', value => { value.managerApproval.requestedAt = 'yesterday'; }],
];

test('requires a complete explicit confirmed USD booking above the policy threshold', async t => {
  for (const [label, mutate] of RESULT_REJECTIONS) await t.test(label, () => {
    const data = capture();
    const result = outputOf(data.spans[1]);
    mutate(result);
    setOutput(data.spans[1], result);
    assert.ok(find(data) === null, label);
  });
});

const CAPTURE_REJECTIONS = [
  ['missing prepare output', data => { delete data.spans[0].attributes['sp.output']; }],
  ['invalid prepare JSON', data => { data.spans[0].attributes['sp.output'] = '{broken'; }],
  ['missing prepare policy', data => editOutput(data, 0, value => { delete value.managerApproval; })],
  ['policy only inferred from messages', data => { delete data.spans[0].attributes['sp.output']; data.messages = [{ content: 'Flights above $600 require approval' }]; }],
  ['wrong prepare policy id', data => editOutput(data, 0, value => { value.managerApproval.policyId = 'other'; })],
  ['wrong prepare version', data => editOutput(data, 0, value => { value.managerApproval.policyVersion = '2.0'; })],
  ['wrong prepare rule', data => editOutput(data, 0, value => { value.managerApproval.ruleId = 'OTHER'; })],
  ['wrong prepare threshold', data => editOutput(data, 0, value => { value.managerApproval.threshold = 601; })],
  ['wrong prepare currency', data => editOutput(data, 0, value => { value.managerApproval.currency = 'EUR'; })],
  ['mismatched request id', data => { data.spans[1].attributes['sp.input'] = JSON.stringify({ requestId: 'another-request' }); }],
  ['malformed request id is not normalized', data => { data.spans[1].attributes['sp.input'] = JSON.stringify({ requestId: ' request-demo-1 ' }); }],
  ['absent prepare id', data => editOutput(data, 0, value => { delete value.id; })],
  ['absent book input', data => { delete data.spans[1].attributes['sp.input']; }],
  ['invalid book input', data => { data.spans[1].attributes['sp.input'] = 'not-json'; }],
  ['prepare after booking', data => { data.spans[0].end_time = '2026-11-05T18:00:03.000Z'; }],
  ['prepare still running', data => { delete data.spans[0].end_time; }],
  ['booking still running', data => { delete data.spans[1].end_time; }],
  ['unknown booking time', data => { data.spans[1].start_time = 'unknown'; }],
  ['reversed booking time', data => { data.spans[1].end_time = '2026-11-05T18:00:01.000Z'; }],
  ['failed prepare span', data => { data.spans[0].status_code = 'ERROR'; }],
  ['failed book span', data => { data.spans[1].status_code = 'ERROR'; }],
  ['wrong prepare tool type', data => { data.spans[0].span_type = 'generation'; }],
  ['wrong book tool type', data => { data.spans[1].span_type = 'generation'; }],
  ['wrong wrapped tool name', data => { const value = JSON.parse(data.spans[1].attributes['sp.output']); value.title = 'travel_order'; data.spans[1].attributes['sp.output'] = JSON.stringify(value); }],
  ['no captured simulation', data => editOutput(data, 1, value => { delete value.demoFault; })],
  ['different simulated fault', data => editOutput(data, 1, value => { value.demoFault.kind = 'different_fault'; })],
  ['missing simulation timestamp', data => editOutput(data, 1, value => { delete value.demoFault.enabledAt; })],
  ['simulation enabled after booking', data => editOutput(data, 1, value => { value.demoFault.enabledAt = '2026-11-05T18:00:05.000Z'; })],
  ['wrong session at capture level', data => { data.session_id = 'other-session'; }],
  ['wrong prepare session', data => { data.spans[0].session_id = 'other-session'; }],
  ['wrong book session', data => { data.spans[1].session_id = 'other-session'; }],
  ['wrong HTTP session', data => { data.spans[2].session_id = 'other-session'; }],
  ['missing captured span id', data => { delete data.spans[1].span_id; }],
  ['missing captured trace id', data => { delete data.spans[1].trace_id; }],
  ['truncated capture', data => { data.truncated = true; }],
  ['declared missing spans', data => { data.span_count = 4; }],
  ['ambiguous duplicate span ids', data => { data.spans.push(structuredClone(data.spans[1])); data.span_count++; }],
  ['failed HTTP span', data => { data.spans[2].status_code = 'ERROR'; }],
  ['missing HTTP method', data => { delete data.spans[2].attributes['http.request.method']; }],
  ['HTTP wrong method', data => { data.spans[2].attributes['http.request.method'] = 'GET'; }],
  ['HTTP failed', data => { data.spans[2].attributes['http.response.status_code'] = '500'; }],
  ['HTTP redirect', data => { data.spans[2].attributes['http.response.status_code'] = '302'; }],
  ['HTTP status missing', data => { delete data.spans[2].attributes['http.response.status_code']; }],
  ['HTTP nonnumeric status', data => { data.spans[2].attributes['http.response.status_code'] = 'success'; }],
  ['HTTP incomplete', data => { delete data.spans[2].end_time; }],
  ['HTTP precedes booking', data => { data.spans[2].start_time = '2026-11-05T18:00:01.000Z'; }],
  ['HTTP other trace', data => { data.spans[2].trace_id = 'other-trace'; }],
  ['HTTP orphan', data => { delete data.spans[2].parent_span_id; }],
  ['HTTP wrong tool parent', data => { data.spans[2].parent_span_id = PREPARE; }],
  ['HTTP ancestry cycle', data => { data.spans[2].parent_span_id = HTTP; }],
  ['HTTP body missing', data => { delete data.spans[2].attributes['http.response.body.content']; }],
  ['HTTP body malformed', data => { data.spans[2].attributes['http.response.body.content'] = '{broken'; }],
  ['HTTP other booking id', data => editBody(data, body => { body.bookingId = 'different-booking'; })],
  ['HTTP unknown booking status', data => editBody(data, body => { body.status = 'PENDING'; })],
  ['HTTP wrong amount', data => editBody(data, body => { body.paymentInfo.amount = 751; })],
  ['HTTP wrong currency', data => editBody(data, body => { body.paymentInfo.currency = 'EUR'; })],
  ['HTTP missing payment evidence', data => editBody(data, body => { delete body.paymentInfo; })],
];
function editOutput(data, index, mutate) {
  const value = outputOf(data.spans[index]); mutate(value); setOutput(data.spans[index], value);
}
function editBody(data, mutate) {
  const value = JSON.parse(data.spans[2].attributes['http.response.body.content']); mutate(value);
  data.spans[2].attributes['http.response.body.content'] = JSON.stringify(value);
}

test('fails closed without matching earlier policy, request, simulation and linked API evidence', async t => {
  for (const [label, mutate] of CAPTURE_REJECTIONS) await t.test(label, () => {
    const data = capture(); mutate(data);
    assert.ok(find(data) === null, label);
  });
});

test('returns null without explicit caller scope rather than inventing identifiers', () => {
  for (const options of [{ workspaceId: undefined }, { workspaceId: '' }, { sessionId: '' }, { sessionId: 'different-session' }, { agentId: '' }]) {
    assert.ok(find(capture(), options) === null);
  }
});

test('supports captured pending approval, direct tool JSON and actual non-200 success codes', () => {
  const data = capture();
  for (const index of [0, 1]) {
    const output = outputOf(data.spans[index]);
    if (index === 1) {
      output.managerApproval.status = 'pending';
      output.managerApproval.requestedAt = '2026-11-05T18:00:01.000Z';
    }
    setOutput(data.spans[index], output, false);
  }
  data.spans[2].attributes['http.response.status_code'] = 201;
  const finding = find(data, { agentId: 'custom-agent' });
  assert.ok(finding);
  assert.match(finding.why_wrong, /pending/);
  assert.match(finding.what_happened, /HTTP 201/);
  assert.doesNotMatch(finding.what_happened, /HTTP 200/);
  assert.equal(finding.agent_id, 'custom-agent');
});

test('follows captured intermediate ancestry and matches prepare across traces in a session', () => {
  const data = capture();
  const intermediate = { ...structuredClone(data.spans[2]), span_id: '5555555555555555', name: 'gateway transport', attributes: {}, parent_span_id: BOOK };
  data.spans[0].trace_id = '99999999999999999999999999999999';
  data.spans[2].parent_span_id = intermediate.span_id;
  data.spans.push(intermediate); data.span_count++;
  const finding = find(data);
  assert.ok(finding);
  assert.deepEqual(finding.implicated_steps.map(step => step.stepId), [PREPARE, BOOK, HTTP]);
});

test('is deterministic and does not mutate frozen capture data or returned records', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const data = freeze(capture());
  const first = find(data);
  const second = find(data);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  first.citation.section = 'changed'; first.implicated_steps[0].text = 'changed';
  assert.deepEqual(find(data), second);
});

test('does not borrow an API booking from a different nested booking tool', () => {
  const data = capture();
  const nested = { ...structuredClone(data.spans[1]), span_id: '5555555555555555', parent_span_id: BOOK, attributes: {} };
  data.spans[2].parent_span_id = nested.span_id;
  data.spans.push(nested); data.span_count++;
  assert.ok(find(data) === null);
});

test('rejects contradictory earlier policy snapshots for the same request id', () => {
  const data = capture();
  const conflicting = { ...structuredClone(data.spans[0]), span_id: '5555555555555555' };
  const output = outputOf(conflicting); output.managerApproval.threshold = 1000; setOutput(conflicting, output);
  data.spans.push(conflicting); data.span_count++;
  assert.ok(find(data) === null);
});

test('selects the same captured finding regardless of capture delivery order', () => {
  const data = capture();
  const earlier = structuredClone(data.spans[0]);
  earlier.span_id = '1111111111111111';
  data.spans.push(earlier); data.span_count++;
  const forward = find(data);
  const reverse = find({ ...data, spans: [...data.spans].reverse() });
  assert.deepEqual(forward, reverse);
});

test('ignores unrelated requests and orphans rather than borrowing their evidence', () => {
  const data = capture();
  const decoyPrepare = { ...structuredClone(data.spans[0]), span_id: '5555555555555555' };
  const output = outputOf(decoyPrepare); output.id = 'other-request'; output.managerApproval.threshold = 1000;
  setOutput(decoyPrepare, output);
  const decoyHttp = { ...structuredClone(data.spans[2]), span_id: '6666666666666666', parent_span_id: 'uncaptured-parent' };
  data.spans.unshift(decoyPrepare, decoyHttp); data.span_count += 2;
  const finding = find(data);
  assert.ok(finding);
  assert.deepEqual(finding.implicated_steps.map(step => step.stepId), [PREPARE, BOOK, HTTP]);
});

test('does not treat traveler confirmation as manager approval', () => {
  const data = capture();
  const prepared = outputOf(data.spans[0]);
  prepared.status = 'approved'; prepared.approvedAt = '2026-11-05T18:00:01.000Z';
  setOutput(data.spans[0], prepared);
  data.messages = [{ role: 'user', content: 'I confirm. Book the exact flight.' }];
  assert.ok(find(data));
  editOutput(data, 1, output => { delete output.managerApproval; });
  assert.ok(find(data) === null, 'no inference from an absent manager message or traveler confirmation');
});

test('accepts strictly greater USD fares and reports the captured amount, not a fixed demo price', () => {
  const data = capture();
  editOutput(data, 1, output => { output.amount = 600.01; });
  editBody(data, body => { body.paymentInfo.amount = 600.01; });
  assert.equal(find(data)?.issue, '$600.01 flight booked without required manager approval');
});

test('malformed capture values fail closed without throwing or synthetic fallback', async t => {
  for (const value of [null, false, 1, [], 'not JSON', {}, { spans: [null] }, { spans: 'bad' }]) {
    assert.ok(find(value) === null);
  }
  for (const index of [0, 1]) for (const raw of [null, false, 1, '[]', '{}', '{broken', '{"output":"not JSON","title":"travel_book"}']) {
    await t.test(`span ${index} output ${JSON.stringify(raw)}`, () => {
      const data = capture(); data.spans[index].attributes['sp.output'] = raw;
      assert.ok(find(data) === null);
    });
  }
});
