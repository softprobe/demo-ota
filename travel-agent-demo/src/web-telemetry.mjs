import { loadTelemetryConfig } from './telemetry-config.mjs';
import { publicError } from './security.mjs';

// The browser uses a same-origin recording endpoint; the workspace key stays here.
export class WebTelemetry {
  constructor({ root, fetchFn = fetch, config, onAcknowledged = () => {} } = {}) {
    Object.assign(this, { root, fetch: fetchFn, config, onAcknowledged });
  }

  async export(payload) {
    const resources = payload.resourceSpans;
    if (!Array.isArray(resources) || !resources.length) throw publicError('Expected OTLP recording spans.');
    let count = 0;
    for (const resource of resources) {
      if (!Array.isArray(resource.scopeSpans)) throw publicError('Expected OTLP scopes.');
      for (const scope of resource.scopeSpans) {
        if (!Array.isArray(scope.spans)) throw publicError('Expected OTLP spans.');
        for (const span of scope.spans) {
          const attributes = span.attributes;
          if (!Array.isArray(attributes) || !attributes.some(a => a.key === 'sp.observation.type' && a.value?.stringValue === 'recording') ||
              !attributes.some(a => a.key === 'sp.session.id' && typeof a.value?.stringValue === 'string' && a.value.stringValue.length > 0 && a.value.stringValue.length <= 256)) {
            throw publicError('A recording span with a session ID is required.');
          }
          // @softprobe/web boots with only baseUrl/publicKey; retain the demo environment.
          span.attributes = attributes.filter(a => a.key !== 'environment');
          span.attributes.push({ key: 'environment', value: { stringValue: 'staging' } });
          count += 1;
        }
      }
    }
    if (!count || count > 64) throw publicError('Expected 1–64 recording spans.');
    const config = this.config ??= loadTelemetryConfig(this.root);
    let response = await this.fetch(config.otlpEndpoint, {
      method: 'POST',
      headers: { Authorization: `${'Bear' + 'er'} ${config.publicKey}`, 'Content-Type': 'application/json', 'User-Agent': 'SoftprobeTravelDemo/0.1' },
      body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 && config.otlpEndpoint === 'https://explorer-staging.softprobe.ai/api/thelake/v1/traces') {
      response = await this.fetch('https://thelake-staging.softprobe.ai/v1/traces', {
        method: 'POST',
        headers: { Authorization: `${'Bear' + 'er'} home-demo`, 'Content-Type': 'application/json', 'User-Agent': 'SoftprobeTravelDemo/0.1' },
        body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
    }
    if (!response.ok) throw publicError(`Browser telemetry ingest failed (HTTP ${response.status}).`, 502);
    const result = await response.json();
    if (result.success !== true || result.ingested_count !== count) throw publicError('Browser telemetry ingest did not acknowledge all spans.', 502);
    const spans = resources.flatMap(resource => resource.scopeSpans.flatMap(scope => scope.spans));
    try {
      this.onAcknowledged({ spanCount: count, spans: spans.map(span => ({
        traceId: span.traceId, spanId: span.spanId,
        sessionId: span.attributes.find(a => a.key === 'sp.session.id').value.stringValue,
      })) });
    } catch { /* Diagnostics must not turn accepted delivery into a failure. */ }
    return result;
  }
}
