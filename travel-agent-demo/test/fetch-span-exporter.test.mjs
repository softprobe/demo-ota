import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoftprobeClient } from '@softprobe/tracing';
import { FetchSpanExporter } from '../src/fetch-span-exporter.mjs';
import proto from '@opentelemetry/otlp-transformer/build/src/generated/root.js';

async function runExporter(fetchFn, options = {}) {
  const exporter = new FetchSpanExporter({ ...options, fetchFn });
  const client = new SoftprobeClient({ publicKey: 'offline-fixture', baseUrl: 'http://127.0.0.1:1', spanExporter: exporter, registerProvider: false, disableGlobalTracerOnShutdown: false });
  const span = client.startAgent({ name: 'offline.transport.check', sessionId: 'ses_offline' });
  span.end();
  return { client, exporter };
}

test('fetch transport sends actual SDK protobuf once and acknowledges a successful response', async () => {
  const requests = [];
  const { client } = await runExporter(async (url, options) => { requests.push({ url, options }); return new Response(null, { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } }); });
  try {
    await client.forceFlush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://127.0.0.1:4319/v1/traces');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer home-demo');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/x-protobuf');
    assert.ok(requests[0].options.body instanceof Uint8Array);
    assert.ok(requests[0].options.body.byteLength > 0);
    assert.equal(requests[0].options.redirect, 'error');
  } finally { await client.shutdown(); }
  assert.equal(requests.length, 1);
});

test('the actual staging JSON acknowledgement completes export without protobuf decoding', async () => {
  let attempts = 0;
  const { client } = await runExporter(async () => {
    attempts += 1;
    return new Response(JSON.stringify({ success: true, ingested_count: 1, message: 'Successfully ingested 1 spans' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try { await client.forceFlush(); } finally { await client.shutdown(); }
  assert.equal(attempts, 1);
});

test('JSON acknowledgements must report complete success rather than merely HTTP 200', async () => {
  for (const ack of [
    { success: false, ingested_count: 1 },
    { success: true },
    { success: true, ingested_count: 0 },
    { success: true, ingested_count: 2 },
    { success: true, ingested_count: '1' },
    { error: 'not accepted' },
    [],
    { partialSuccess: { rejectedSpans: -1 } },
    { partialSuccess: { rejectedSpans: ' ' } },
    { partialSuccess: 'malformed' },
  ]) {
    let attempts = 0;
    const { client } = await runExporter(async () => { attempts += 1; return new Response(JSON.stringify(ack), { status: 200, headers: { 'Content-Type': 'application/json' } }); });
    await assert.rejects(() => client.forceFlush(), `Unexpected accepted acknowledgement: ${JSON.stringify(ack)}`);
    await client.shutdown().catch(() => {});
    assert.equal(attempts, 1);
  }
});

test('acknowledgement decoding respects the declared content type and requires valid JSON', async () => {
  for (const [contentType, body] of [
    ['text/plain', new Uint8Array([0x20, 0])],
    ['application/json', ''],
    ['text/html', ''],
    ['application/json', '{'],
  ]) {
    const { client } = await runExporter(async () => new Response(body, { status: 200, headers: { 'Content-Type': contentType } }));
    await assert.rejects(() => client.forceFlush());
    await client.shutdown().catch(() => {});
  }
});

test('acknowledgement diagnostics run only after validation and cannot break delivery', async () => {
  const acknowledgements = [];
  for (const success of [true, false]) {
    const { client } = await runExporter(async () => new Response(JSON.stringify({ success, ingested_count: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }), {
      onAcknowledged: count => { acknowledgements.push(count); throw new Error('offline diagnostic failure'); },
    });
    if (success) await client.forceFlush();
    else await assert.rejects(() => client.forceFlush());
    await client.shutdown().catch(() => {});
  }
  assert.deepEqual(acknowledgements, [1]);
});

test('standard OTLP JSON and protobuf acknowledgements remain supported', async () => {
  const responseType = proto.opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;
  for (const [body, contentType, accepted] of [
    ['{}', 'application/json', true],
    [JSON.stringify({ partialSuccess: { rejectedSpans: '0' } }), 'application/json', true],
    [JSON.stringify({ partialSuccess: { rejectedSpans: '1' } }), 'application/json', false],
    [responseType.encode({ partialSuccess: { rejectedSpans: 0 } }).finish(), 'application/x-protobuf', true],
    [responseType.encode({ partialSuccess: { rejectedSpans: 1 } }).finish(), 'application/x-protobuf', false],
  ]) {
    const { client } = await runExporter(async () => new Response(body, { status: 200, headers: { 'Content-Type': contentType } }));
    if (accepted) await client.forceFlush();
    else await assert.rejects(() => client.forceFlush());
    await client.shutdown().catch(() => {});
  }
});

test('failed/ambiguous ingest is surfaced without automatic duplicate delivery', async () => {
  let attempts = 0;
  const { client } = await runExporter(async () => { attempts += 1; throw new Error('offline acknowledgement failure'); });
  await assert.rejects(() => client.forceFlush());
  await client.shutdown().catch(() => {});
  assert.equal(attempts, 1);
});
