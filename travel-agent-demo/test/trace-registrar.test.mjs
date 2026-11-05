import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceRegistrar } from '../src/trace-registrar.mjs';

test('registers the exact actual trace/session before a downstream call, never a generated ID', async () => {
  const calls = [];
  const registrar = new TraceRegistrar({ token: 'offline-capability', fetchFn: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); } });
  const traceparent = '00-1234567890abcdef1234567890abcdef-0123456789abcdef-01';
  await registrar.register('ses_offline', traceparent);
  assert.equal(calls[0].url, 'http://127.0.0.1:4319/register');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer offline-capability');
  assert.deepEqual(JSON.parse(calls[0].options.body), { traceId: '1234567890abcdef1234567890abcdef', sessionId: 'ses_offline' });
  await assert.rejects(() => registrar.register('ses_offline', 'invalid'), /trace/i);
  assert.equal(calls.length, 1);
});

test('a rejected trace registration prevents quietly losing Session correlation', async () => {
  for (const status of [200, 409]) {
    const registrar = new TraceRegistrar({ token: 'offline-capability', fetchFn: async () => new Response('{}', { status }) });
    await assert.rejects(() => registrar.register('ses_offline', '00-1234567890abcdef1234567890abcdef-0123456789abcdef-01'), /registration/i);
  }
});
