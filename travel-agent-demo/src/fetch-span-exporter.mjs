import { ProtobufTraceSerializer } from '@opentelemetry/otlp-transformer';
import { ExportResultCode } from '@opentelemetry/core';

// Keep the SDK's actual ReadableSpans and standard OTLP serializer. Only replace
// the Node-http transport, which timed out under this OpenCode/Bun runtime after
// successful ingest and consequently redelivered identical span IDs.
export class FetchSpanExporter {
  constructor({ fetchFn = fetch, onAcknowledged = () => {} } = {}) {
    this.fetch = fetchFn;
    this.onAcknowledged = onAcknowledged;
    this.pending = new Set();
    this.closed = false;
  }

  export(spans, callback) {
    if (this.closed) { callback({ code: ExportResultCode.FAILED, error: new Error('Trace exporter is closed.') }); return; }
    const work = this.send(spans).then(
      () => callback({ code: ExportResultCode.SUCCESS }),
      error => callback({ code: ExportResultCode.FAILED, error }),
    );
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => {});
  }

  async send(spans) {
    const body = ProtobufTraceSerializer.serializeRequest(spans);
    const response = await this.fetch('http://127.0.0.1:4319/v1/traces', {
      method: 'POST',
      headers: { Authorization: 'Bearer home-demo', 'Content-Type': 'application/x-protobuf', Accept: 'application/x-protobuf' },
      body, signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    if (response.status !== 200) throw new Error(`Trace ingest failed (HTTP ${response.status}); delivery was not retried.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 1_000_000) throw new Error('Trace ingest acknowledgement was too large.');
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['application/json', 'application/x-protobuf', 'application/protobuf', 'application/octet-stream'].includes(contentType)) throw new Error('Unsupported trace acknowledgement content type.');
    const result = contentType === 'application/json'
      ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      : bytes.byteLength ? ProtobufTraceSerializer.deserializeResponse(bytes) : {};
    if (contentType === 'application/json') {
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid JSON trace acknowledgement.');
      if (Object.hasOwn(result, 'success') || Object.hasOwn(result, 'ingested_count')) {
        if (result.success !== true || !Number.isInteger(result.ingested_count) || result.ingested_count !== spans.length) {
          throw new Error('Trace acknowledgement did not confirm the complete submitted span count; delivery was not retried.');
        }
      } else if (Object.keys(result).some(key => key !== 'partialSuccess')) {
        throw new Error('Unrecognized JSON trace acknowledgement.');
      }
      const partial = result.partialSuccess;
      if (partial !== undefined && (!partial || typeof partial !== 'object' || Array.isArray(partial))) throw new Error('Invalid partial-success trace acknowledgement.');
      const value = partial?.rejectedSpans;
      if (value !== undefined && !(typeof value === 'number' && Number.isInteger(value) && value >= 0) && !(typeof value === 'string' && /^\d+$/.test(value))) throw new Error('Invalid rejected-span count in trace acknowledgement.');
    }
    const rejected = Number(result.partialSuccess?.rejectedSpans ?? 0);
    if (!Number.isSafeInteger(rejected) || rejected !== 0) throw new Error(`Trace ingest rejected spans (${rejected}); delivery was not retried.`);
    try { this.onAcknowledged(spans.length); } catch { /* Diagnostics must not turn accepted delivery into a failure. */ }
  }

  async forceFlush() { await Promise.all([...this.pending]); }
  async shutdown() { this.closed = true; await this.forceFlush(); }
}
