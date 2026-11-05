// A real application-request diagnostic, not an OpenCode/model conversation.
import { randomUUID } from 'node:crypto';
import { writeFile, readFile } from 'node:fs/promises';
import { BridgedSoftprobeClient, toolHeaders, releaseTool } from '../src/trace-bridge.mjs';
import { TravelAPI } from '../src/travel-api.mjs';
import { TraceRegistrar } from '../src/trace-registrar.mjs';
import { loadTelemetryConfig } from '../src/telemetry-config.mjs';
import { FetchSpanExporter } from '../src/fetch-span-exporter.mjs';

const sessionId = `travel-preflight-${randomUUID()}`;
const callId = 'preflight-search';
const client = new BridgedSoftprobeClient({ ...loadTelemetryConfig(), spanExporter: new FetchSpanExporter(), serviceName: 'travel-stack-preflight', registerProvider: false, disableGlobalTracerOnShutdown: false, headers: { 'User-Agent': 'SoftprobeTravelDemo/0.1' } });
const tool = client.startTool({ name: 'preflight.flight_search', sessionId, toolCallId: callId, root: true });
const date = new Date(); date.setDate(date.getDate() + 7);
const request = { origin: 'LHR', destination: 'CDG', date: date.toISOString().slice(0, 10) };
try {
  const headers = toolHeaders(sessionId, callId);
  const registrar = new TraceRegistrar({ token: (await readFile('.runtime/forwarder-token', 'utf8')).trim() });
  await registrar.register(sessionId, headers.traceparent);
  const offers = await new TravelAPI().search(request, headers);
  tool.update({ input: request, output: { offerCount: offers.length } });
  tool.end();
  await client.forceFlush();
  const evidence = { diagnosticOnly: true, modelCalls: 0, sessionId, traceId: tool.traceId, toolSpanId: tool.spanId, offerCount: offers.length, observedAt: new Date().toISOString() };
  await writeFile('.runtime/preflight-trace.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) { tool.recordException(error); tool.end(); throw error; }
finally { releaseTool(sessionId, callId); await client.shutdown(); }
