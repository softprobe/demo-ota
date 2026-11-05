import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebTelemetry } from '../src/web-telemetry.mjs';

const config = { publicKey: 'spk_offline_fixture', otlpEndpoint: 'https://explorer-staging.softprobe.ai/api/thelake/v1/traces' };
const recording = () => ({ resourceSpans: [{ scopeSpans: [{ spans: [{
  traceId: '1234567890abcdef1234567890abcdef', spanId: '1234567890abcdef',
  name: 'softprobe.web.recording', attributes: [
    { key: 'sp.session.id', value: { stringValue: 'ses_browser_fixture' } },
    { key: 'sp.observation.type', value: { stringValue: 'recording' } },
  ], events: [{ name: 'sp.recording.batch' }],
}] }] }] });

test('browser recording proxy uses the workspace key and preserves session/trace IDs and events', async () => {
  let sent;
  let acknowledged;
  const proxy = new WebTelemetry({ config, onAcknowledged: evidence => { acknowledged = evidence; }, fetchFn: async (url, options) => {
    sent = { url, ...options, payload: JSON.parse(options.body) };
    return Response.json({ success: true, ingested_count: 1 });
  } });
  const payload = recording();
  await proxy.export(payload);
  assert.equal(sent.url, config.otlpEndpoint);
  assert.equal(sent.headers.Authorization, `Bearer ${config.publicKey}`);
  assert.equal(sent.redirect, 'error');
  const span = sent.payload.resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(span.traceId, '1234567890abcdef1234567890abcdef');
  assert.equal(span.attributes.find(a => a.key === 'sp.session.id').value.stringValue, 'ses_browser_fixture');
  assert.equal(span.attributes.find(a => a.key === 'environment').value.stringValue, 'staging');
  assert.deepEqual(span.events, [{ name: 'sp.recording.batch' }]);
  assert.deepEqual(acknowledged, { spanCount: 1, spans: [{ traceId: span.traceId, spanId: span.spanId, sessionId: 'ses_browser_fixture' }] });
});

test('browser recording proxy rejects missing session IDs and incomplete ingestion acknowledgements', async () => {
  let calls = 0;
  const proxy = new WebTelemetry({ config, fetchFn: async () => { calls += 1; return Response.json({ success: true, ingested_count: 0 }); } });
  const bad = recording();
  bad.resourceSpans[0].scopeSpans[0].spans[0].attributes.shift();
  await assert.rejects(proxy.export(bad), /session ID/);
  assert.equal(calls, 0);
  await assert.rejects(proxy.export(recording()), /acknowledge/);
});
