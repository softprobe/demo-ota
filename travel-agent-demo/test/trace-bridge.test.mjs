import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { BridgedSoftprobeClient, toolHeaders, releaseTool } from '../src/trace-bridge.mjs';

test('HTTP propagation points to the actual Softprobe tool span, not a fabricated span', async () => {
  const exporter = new InMemorySpanExporter();
  const client = new BridgedSoftprobeClient({ publicKey: 'offline-test', baseUrl: 'http://127.0.0.1:1', spanExporter: exporter, useSimpleProcessor: true, registerProvider: false, disableGlobalTracerOnShutdown: false });
  try {
    const turn = client.startAgent({ name: 'test-turn', sessionId: 'ses_offline', root: true });
    const tool = client.startTool({ name: 'travel_search', parent: turn, sessionId: 'ses_offline', toolCallId: 'call_offline' });
    const headers = toolHeaders('ses_offline', 'call_offline');
    const parts = headers.traceparent.split('-');
    assert.equal(parts[1], tool.traceId);
    assert.equal(parts[2], tool.spanId);
    assert.equal(headers['x-sp-session-id'], 'ses_offline');
    assert.throws(() => toolHeaders('other_session', 'call_offline'), /correlation/i);
    releaseTool('ses_offline', 'call_offline');
    assert.throws(() => toolHeaders('ses_offline', 'call_offline'), /correlation/i);
    tool.end(); turn.end();
    await client.forceFlush();
    const spans = exporter.getFinishedSpans();
    assert.equal(spans.find(span => span.name === 'travel_search').parentSpanId, turn.spanId);
  } finally { await client.shutdown(); }
});
