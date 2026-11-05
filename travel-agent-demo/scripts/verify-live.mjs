// Read-only verification of the existing completed booking and its actual trace.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { loadTelemetryConfig } from '../src/telemetry-config.mjs';
const telemetry = loadTelemetryConfig();
const records = JSON.parse(await readFile('.runtime/sessions.json', 'utf8'));
const id = process.argv[2] ?? records.at(-1)?.id;
assert.match(id ?? '', /^ses_[A-Za-z0-9_-]+$/);
const sessionResponse = await fetch(`http://127.0.0.1:4310/api/sessions/${id}`);
assert.equal(sessionResponse.status, 200);
const session = await sessionResponse.json();
assert.equal(session.pending?.status, 'completed');
assert.equal(session.booking?.verified, true);
assert.equal(session.busy, false);
assert.equal(session.lastError, null);
const b = session.booking;
// No agent/session headers: this independent operator read must not pretend to
// be another action of the agent's existing trace.
const orderResponse = await fetch('http://127.0.0.1:8080/api/flights/orders/query', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ confirmationNumber: b.confirmationNumber, passengerLastName: b.passenger.lastName }),
  signal: AbortSignal.timeout(15_000),
});
assert.equal(orderResponse.status, 200);
const order = await orderResponse.json();
assert.equal(order.bookingId, b.bookingId);
assert.equal(order.confirmationNumber, b.confirmationNumber);
assert.equal(order.flightInfo.flightId, session.pending.offer.flightId);
assert.equal(order.paymentInfo.amount, session.pending.offer.total);
assert.equal(order.paymentInfo.currency, session.pending.offer.currency);
assert.equal(order.paymentInfo.paymentStatus, 'PENDING');
assert.equal(order.passengers.length, 1);
assert.equal(order.passengers[0].firstName, 'Alex');
assert.equal(order.passengers[0].lastName, 'Demo');
assert.equal(order.passengers[0].passengerType, 'ADULT');
let trace;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const response = await fetch(`${telemetry.baseUrl}/v1/llm/sessions/${id}`, { headers: { Authorization: `Bearer ${telemetry.publicKey}`, 'User-Agent': 'SoftprobeTravelDemo/0.1' }, signal: AbortSignal.timeout(15_000) });
  if (response.ok) { trace = await response.json(); if (trace.spans?.some(span => span.name === 'POST /api/flights/orders/query')) break; }
  else if (response.status !== 404) throw new Error(`Staging Session read HTTP ${response.status}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
}
assert.ok(trace?.spans?.length, 'No actual Session spans found.');
const spans = trace.spans;
assert.equal(trace.span_count, spans.length, 'Declared span count mismatch.');
const keys = new Set(spans.map(span => `${span.trace_id}:${span.span_id}`));
assert.equal(keys.size, spans.length, 'Duplicate span deliveries remain.');
assert.ok(spans.every(span => span.session_id === id));
const nodes = new Map(spans.map(span => [`${span.trace_id}:${span.span_id}`, span]));
function underTool(span, name) {
  const seen = new Set();
  while (span.parent_span_id) {
    const key = `${span.trace_id}:${span.parent_span_id}`;
    if (seen.has(key) || !nodes.has(key)) return false;
    seen.add(key); span = nodes.get(key);
    if (span.span_type === 'tool' && (!name || span.name === name)) return true;
  }
  return false;
}
const tools = spans.filter(span => span.span_type === 'tool');
const generations = spans.filter(span => span.span_type === 'generation');
for (const name of ['travel_search', 'travel_prepare', 'travel_book']) assert.equal(tools.filter(span => span.name === name).length, 1, `Expected one actual ${name} call.`);
assert.ok(generations.length > 0, 'Model generations are absent.');
const required = [['POST /api/flights/search', 'travel_search'], ['POST /api/flights/book', 'travel_book'], ['POST /api/flights/orders/query', 'travel_book']];
for (const [name, tool] of required) assert.ok(spans.some(span => span.name === name && underTool(span, tool)), `${name} is not descended from its actual tool span.`);
assert.ok(spans.some(span => span.name.includes('/airline-api/') && underTool(span)), 'No linked airline span.');
const http = spans.filter(span => span.name.startsWith('POST '));
const orphanHttp = http.filter(span => !underTool(span));
const summary = {
  verified: true, observedAt: new Date().toISOString(), sessionId: id,
  bookingId: b.bookingId, confirmationNumber: b.confirmationNumber,
  route: `${b.flightInfo.departureAirport} → ${b.flightInfo.arrivalAirport}`,
  flight: b.flightInfo.flightNumber, departureTime: b.flightInfo.departureTime,
  amount: b.amount, currency: b.currency, paymentStatus: b.paymentStatus,
  independentOrderReadBack: true, reportedSpans: trace.span_count, uniqueSpans: keys.size,
  modelGenerations: generations.length, tools: tools.map(span => span.name),
  httpSpanCount: http.length, connectedHttpSpanCount: http.length - orphanHttp.length,
  extraHttpSpansWithoutToolAncestry: orphanHttp.map(span => ({ name: span.name, traceId: span.trace_id, spanId: span.span_id, parentSpanId: span.parent_span_id })),
  conversationsAttempted: records.filter(record => record.used).length,
  approvedConversationLimit: (await (await fetch('http://127.0.0.1:4310/api/status')).json()).conversationLimit, softprobeUrl: session.softprobeUrl,
};
await writeFile(`verification/session-${id}.json`, JSON.stringify(trace, null, 2));
await writeFile('verification/booking-readback.json', JSON.stringify(order, null, 2));
await writeFile('verification/live-success.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
