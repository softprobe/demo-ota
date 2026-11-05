import { SoftprobeClient } from '@softprobe/tracing';
import { ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

const contexts = new Map();
const propagator = new W3CTraceContextPropagator();
const keyFor = (sessionId, callId) => `${sessionId}\u0000${callId}`;

export class BridgedSoftprobeClient extends SoftprobeClient {
  startTool(options) {
    const observation = super.startTool(options);
    if (options.sessionId && options.toolCallId) {
      for (const [key, entry] of contexts) if (entry.expires < Date.now()) contexts.delete(key);
      if (contexts.size >= 1000) contexts.delete(contexts.keys().next().value);
      contexts.set(keyFor(options.sessionId, options.toolCallId), {
        spanContext: observation.otelSpan.spanContext(),
        expires: Date.now() + 300_000,
      });
    }
    return observation;
  }
}

export function toolHeaders(sessionId, callId) {
  const entry = contexts.get(keyFor(sessionId, callId));
  if (!entry || entry.expires < Date.now()) throw new Error('Softprobe tool correlation is unavailable; no application request was sent.');
  const headers = { 'x-sp-session-id': sessionId };
  const context = trace.setSpanContext(ROOT_CONTEXT, entry.spanContext);
  propagator.inject(context, headers, { set: (carrier, key, value) => { carrier[key] = value; } });
  if (!headers.traceparent) throw new Error('Softprobe tool correlation could not be propagated.');
  return headers;
}

export function releaseTool(sessionId, callId) { contexts.delete(keyFor(sessionId, callId)); }
export function releaseSession(sessionId) {
  for (const key of contexts.keys()) if (key.startsWith(`${sessionId}\u0000`)) contexts.delete(key);
}
