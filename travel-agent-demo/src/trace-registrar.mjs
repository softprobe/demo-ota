const TRACEPARENT = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

export class TraceRegistrar {
  constructor({ token, fetchFn = fetch }) { this.token = token; this.fetch = fetchFn; }

  async health() {
    try { return (await this.fetch('http://127.0.0.1:4319/healthz', { signal: AbortSignal.timeout(2000), redirect: 'error' })).ok; }
    catch { return false; }
  }

  async register(sessionId, traceparent) {
    if (!TRACEPARENT.test(traceparent ?? '') || typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) throw new Error('A real trace context and session ID are required.');
    if (!this.token) throw new Error('The private Session forwarding capability is missing.');
    const response = await this.fetch('http://127.0.0.1:4319/register', {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceId: traceparent.split('-')[1], sessionId }),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (response.status !== 204) throw new Error(`Session trace registration failed (HTTP ${response.status}). No application request was sent.`);
  }
}
