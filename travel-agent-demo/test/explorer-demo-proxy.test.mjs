import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { request } from 'node:http';
import { once } from 'node:events';
import { TRAVEL_POLICY } from '../src/travel-policy.mjs';

const { createExplorerDemoServer } = await import('../src/explorer-demo-proxy.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('../src/explorer-demo-proxy.mjs', import.meta.url).href) return {};
  throw error;
});
const options = { root: '/unused-test-root', apiKey: 'private-test-key', workspaceId: 'test-workspace' };

async function fixture(t, { handler = () => new Response('{}', { status: 404 }), records = [{ id: 'ses_local' }], ...overrides } = {}) {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'explorer-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const clientDir = join(root, '.runtime/explorer-client');
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await writeFile(join(clientDir, 'index.html'), '<html>fixture explorer</html>');
  await writeFile(join(clientDir, 'assets/app.js'), 'console.log("fixture");');
  await writeFile(join(root, '.runtime/explorer-demo.json'), JSON.stringify({ apiKey: options.apiKey }));
  await writeFile(join(root, '.runtime/sessions.json'), JSON.stringify(records));
  const calls = [];
  const server = createExplorerDemoServer({ ...options, root, clientDir, ...overrides, fetchFn: async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;
  const send = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, headers: { host, ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }), ...headers } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', error => reject(Object.assign(error, { message: `${method} ${path}: ${error.message}` })));
    req.end(body);
  });
  return { root, clientDir, calls, send, host, origin: `http://${host}` };
}

test('canonicalizes only registered session reads and keeps credentials server-side', async t => {
  const data = { session_id: 'ses_local', span_count: 1, spans: [{ trace_id: 'test-trace', span_id: 'test-span', name: 'captured tool', session_id: 'ses_local' }] };
  const recording = { session_id: 'ses_local', batches: [], events: [] };
  const f = await fixture(t, { handler: url => Response.json(url.includes('/recording') ? recording : data) });
  const detail = await f.send('/api/thelake/v1/llm/sessions/ses_local', { headers: { authorization: 'Bearer browser-spoof', 'x-workspace-id': 'other' } });
  assert.deepEqual(detail.json(), data);
  assert.deepEqual((await f.send('/api/thelake/v1/llm/sessions/ses_local/recording?limit=200')).json(), recording);
  assert.equal(f.calls[0].url, 'https://thelake-staging.softprobe.ai/v1/sessions/ses_local');
  assert.equal(f.calls[1].url, 'https://thelake-staging.softprobe.ai/v1/sessions/ses_local/recording?limit=200');
  for (const { init } of f.calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, `Bearer ${options.apiKey}`);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.body, undefined);
    assert.ok(!JSON.stringify(init.headers).includes('browser-spoof'));
  }
  for (const path of ['/api/thelake/v1/llm/sessions/ses_foreign', '/api/thelake/v1/llm/sessions/ses_foreign/recording',
    '/api/thelake/v1/llm/sessions/ses_local?url=http://evil.test', '/api/thelake/v1/llm/sessions/ses_local/recording?workspace_id=other',
    '/api/thelake/v1/llm/sessions/ses_local/recording?limit=200&limit=300', '/api/thelake/v1/llm/sessions/ses_local/recording?limit=-1',
    '/api/thelake/v1/llm/sessions/ses_local%2f..%2fses_foreign', '/api/thelake/v1/search']) {
    assert.ok([400, 403, 404].includes((await f.send(path)).status), path);
  }
  assert.equal(f.calls.length, 2);
  assert.ok(!detail.text.includes(options.apiKey));
  assert.equal(detail.headers['access-control-allow-origin'], undefined);
  await writeFile(join(f.root, '.runtime/sessions.json'), '[]');
  assert.equal((await f.send('/api/thelake/v1/llm/sessions/ses_local')).status, 404, 'registry revocation defeats cache');
});

test('trace reads expose only spans previously seen in still-registered sessions', async t => {
  const data = { session_id: 'ses_local', spans: [{ trace_id: 'test-trace', span_id: 'test-span', session_id: 'ses_local' }], scores: [] };
  const f = await fixture(t, { handler: () => Response.json(data) });
  assert.equal((await f.send('/api/thelake/v1/llm/traces/test-trace')).status, 404);
  await f.send('/api/thelake/v1/llm/sessions/ses_local');
  const trace = await f.send('/api/thelake/v1/llm/traces/test-trace?session_id=ses_local&limit=200');
  assert.equal(trace.status, 200);
  assert.deepEqual(trace.json().spans, data.spans);
  assert.equal(trace.json().trace.trace_id, 'test-trace');
  assert.equal((await f.send('/api/thelake/v1/llm/traces/foreign-trace')).status, 404);
  assert.equal((await f.send('/api/thelake/v1/llm/traces/test-trace?session_id=ses_foreign')).status, 404);
  assert.equal(f.calls.length, 1, 'trace projection must never broaden to a full upstream trace');
  await writeFile(join(f.root, '.runtime/sessions.json'), '[]');
  assert.equal((await f.send('/api/thelake/v1/llm/traces/test-trace')).status, 404);
});

test('fails closed on malformed registries, upstream errors, redirects and mismatched sessions', async t => {
  for (const handler of [
    () => new Response('missing', { status: 404 }),
    () => { throw new Error(options.apiKey); },
    () => new Response('', { status: 302, headers: { location: 'http://evil.test' } }),
    () => new Response(options.apiKey, { status: 500 }),
    () => new Response('not JSON'),
    () => Response.json({ session_id: 'ses_foreign', spans: [] }),
    () => Response.json({ session_id: 'ses_local', workspace_id: 'foreign-workspace', spans: [] }),
    () => Response.json({ session_id: 'ses_local', spans: [{ session_id: 'ses_foreign', trace_id: 'foreign' }] }),
  ]) {
    const f = await fixture(t, { handler });
    const result = await f.send('/api/thelake/v1/llm/sessions/ses_local');
    assert.ok([404, 502, 504].includes(result.status));
    assert.ok(!result.text.includes(options.apiKey));
    const findings = await f.send('/api/ops/findings');
    assert.deepEqual(findings.json().items, []);
  }
  const f = await fixture(t);
  for (const registry of ['not-json', '{}', '[{"id":" ses_local "}]', '[{"id":"ses_local"},{"id":"ses_local"}]']) {
    await writeFile(join(f.root, '.runtime/sessions.json'), registry);
    assert.equal((await f.send('/api/thelake/v1/llm/sessions/ses_local')).status, 503);
  }
  assert.equal(f.calls.length, 0);
});

// Synthetic unit fixtures in the captured-Session schema; NOT real telemetry.
function bypassFixture() {
  const approval = { ...TRAVEL_POLICY, status: 'not_requested', requestedAt: null };
  const span = (span_id, name, start_time, end_time, attributes, extra = {}) => ({
    session_id: 'ses_local', trace_id: 'fixture-trace', span_id, name, start_time, end_time, attributes, span_type: 'tool', status_code: 'OK', ...extra,
  });
  const booking = { verified: true, status: 'CONFIRMED', bookingId: 'fixture-booking', confirmationNumber: 'TEST', amount: 750, currency: 'USD', flightInfo: { flightId: 'fixture-flight' }, managerApproval: approval, demoFault: { kind: 'skip_manager_approval', enabledAt: '2026-01-01T00:00:01Z' } };
  return { session_id: 'ses_local', span_count: 3, spans: [
    span('fixture-prepare', 'travel_prepare', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', { 'sp.output': JSON.stringify({ id: 'fixture-request', managerApproval: approval }) }),
    span('fixture-book', 'travel_book', '2026-01-01T00:00:02Z', '2026-01-01T00:00:04Z', { 'sp.input': JSON.stringify({ requestId: 'fixture-request' }), 'sp.output': JSON.stringify(booking) }),
    span('fixture-http', 'POST /api/flights/book', '2026-01-01T00:00:02Z', '2026-01-01T00:00:03Z', { 'http.route': '/api/flights/book', 'http.request.method': 'POST', 'http.response.status_code': 200, 'http.response.body.content': JSON.stringify({ bookingId: booking.bookingId, status: 'CONFIRMED', paymentInfo: { amount: 750, currency: 'USD' } }) }, { parent_span_id: 'fixture-book', span_type: 'span' }),
  ] };
}

test('returns evidence-gated findings, exact filtering, detail and read-only evidence', async t => {
  const data = bypassFixture();
  const f = await fixture(t, { handler: () => Response.json(data) });
  const result = await f.send('/api/ops/findings?session_id=ses_local&status=open&agent_id=travel-agent');
  assert.equal(result.status, 200);
  const [finding] = result.json().items;
  assert.ok(finding);
  assert.equal(finding.workspace_id, options.workspaceId);
  assert.equal(finding.span_id, 'fixture-book');
  assert.equal(finding.created_at, data.spans[1].end_time);
  assert.equal(finding.eval_name, 'scenario-specific deterministic demo adapter');
  for (const query of ['status=dismissed', 'session_id=ses_foreign', 'agent_id=foreign', 'workspace_id=other', 'result=pass', 'trace_id=other', 'from=2027-01-01T00:00:00Z', 'to=2025-01-01T00:00:00Z']) {
    assert.deepEqual((await f.send(`/api/ops/findings?${query}`)).json().items, [], query);
  }
  const path = `/api/ops/findings/${encodeURIComponent(finding.finding_id)}`;
  assert.deepEqual((await f.send(path)).json().finding, finding);
  assert.deepEqual((await f.send(`${path}/trace`)).json().trace.spans, data.spans);
  assert.equal((await f.send('/api/ops/findings/missing')).status, 404);
  assert.equal(f.calls.length, 1, 'all findings/detail requests share a short session cache');
  const incomplete = structuredClone(data);
  incomplete.spans.pop();
  const missing = await fixture(t, { handler: () => Response.json(incomplete) });
  assert.deepEqual((await missing.send('/api/ops/findings')).json().items, []);
});

test('policy and agent responses use real rule text and no fabricated activity timestamps', async t => {
  const f = await fixture(t);
  const policies = (await f.send('/api/ops/policies')).json();
  assert.deepEqual(policies.items, policies.policies);
  const [policy] = policies.policies;
  assert.equal(policy.id, TRAVEL_POLICY.policyId);
  assert.equal(policy.name, TRAVEL_POLICY.name);
  assert.equal(policy.description, TRAVEL_POLICY.text);
  assert.equal(policy.rules[0].id, TRAVEL_POLICY.ruleId);
  assert.equal(policy.rules[0].text, TRAVEL_POLICY.text);
  assert.equal(policy.rules[0].citation.exactExcerpt, TRAVEL_POLICY.text);
  assert.deepEqual(policy.recommendations, []);
  const agents = (await f.send('/api/agents')).json().agents;
  assert.equal(agents[0].id, 'travel-agent');
  assert.equal(agents[0].lastCapture, null);
  assert.equal(agents[0].capture, 'disconnected');
  assert.ok(!JSON.stringify({ policies, agents }).includes(options.apiKey));
  assert.equal(f.calls.length, 0);
});

test('deduplicates concurrent fanout, limits concurrency and refreshes the short cache', async t => {
  let active = 0, peak = 0;
  const records = Array.from({ length: 9 }, (_, i) => ({ id: `ses_test_${i}` }));
  const f = await fixture(t, { records, handler: async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return Response.json({ session_id: url.split('/').at(-1), spans: [] });
  } });
  const results = await Promise.all(Array.from({ length: 4 }, () => f.send('/api/ops/findings')));
  assert.ok(results.every(result => result.status === 200 && result.json().items.length === 0));
  assert.equal(f.calls.length, records.length);
  assert.ok(peak > 1 && peak <= 4, `upstream concurrency: ${peak}`);
  await new Promise(resolve => setTimeout(resolve, 1100));
  await f.send('/api/ops/findings');
  assert.equal(f.calls.length, records.length * 2);
});

test('bounds a hung upstream even when an injected transport ignores cancellation', async t => {
  const f = await fixture(t, { handler: () => new Promise(() => {}) });
  const started = Date.now();
  const result = await f.send('/api/thelake/v1/llm/sessions/ses_local');
  assert.equal(result.status, 504);
  assert.ok(Date.now() - started < 6000);
  assert.ok(f.calls[0].init.signal.aborted);
});

test('refuses non-loopback binding and defaults an ephemeral listener to loopback', async t => {
  const server = createExplorerDemoServer(options);
  assert.throws(() => server.listen(0, '0.0.0.0'), /loopback/i);
  assert.throws(() => server.listen({ port: 0, host: '192.0.2.1' }), /loopback/i);
  server.listen(0);
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
});

test('requires explicit private scope and restricts upstream origins', () => {
  assert.equal(typeof createExplorerDemoServer, 'function', 'the local adapter must exist');
  for (const invalid of [
    { apiKey: undefined }, { apiKey: '' }, { apiKey: 'key\r\ninjected: true' },
    { workspaceId: undefined }, { workspaceId: '' }, { root: undefined },
    ...['http://thelake-staging.softprobe.ai', 'https://evil.test', 'http://127.0.0.1.evil.test',
      'http://169.254.169.254', 'https://thelake-staging.softprobe.ai.evil.test',
      'https://user:pass@thelake-staging.softprobe.ai', 'https://thelake-staging.softprobe.ai/private',
      'https://thelake-staging.softprobe.ai?url=http://evil.test', 'https://thelake-staging.softprobe.ai:444',
      'https://thelake-staging.softprobe.ai#fragment'].map(thelakeOrigin => ({ thelakeOrigin })),
  ]) assert.throws(() => createExplorerDemoServer({ ...options, ...invalid }), /required|invalid|origin|scope/i);
  for (const thelakeOrigin of [undefined, 'https://thelake-staging.softprobe.ai', 'http://localhost:9999', 'http://127.0.0.1:9999']) {
    const server = createExplorerDemoServer({ ...options, thelakeOrigin });
    assert.equal(typeof server.listen, 'function');
    server.close();
  }
});

test('serves only built assets and SPA routes without exposing runtime files or symlinks', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('/')).text, '<html>fixture explorer</html>');
  assert.equal((await f.send('/sessions/ses_local')).status, 200);
  const asset = await f.send('/assets/app.js');
  assert.match(asset.headers['content-type'], /javascript/);
  assert.equal((await f.send('/assets/app.js', { method: 'HEAD' })).text, '');
  await writeFile(join(f.root, '.runtime/private.js'), options.apiKey);
  await symlink(join(f.root, '.runtime/explorer-demo.json'), join(f.clientDir, 'assets/leak.js'));
  await symlink(join(f.root, '.runtime'), join(f.clientDir, 'linked'));
  for (const path of ['/.runtime/explorer-demo.json', '/%2e%2e/.runtime/explorer-demo.json',
    '/assets/%2e%2e/%2e%2e/sessions.json', '/assets%2f..%2f..%2fexplorer-demo.json',
    '/assets/leak.js', '/linked/private.js', '/linked/explorer-demo.json', '/assets/missing.js', '/%zz', '/src/start.mjs', '/api/unknown']) {
    const result = await f.send(path);
    assert.ok([400, 403, 404].includes(result.status), `${path}: ${result.status}`);
    assert.ok(!result.text.includes(options.apiKey));
  }
  assert.equal(f.calls.length, 0);
});

test('rejects DNS rebinding, cross-origin requests and every write without upstream calls', async t => {
  const f = await fixture(t);
  for (const headers of [
    { host: 'evil.test' }, { host: `127.0.0.1:${Number(f.host.split(':')[1]) + 1}` },
    { origin: 'https://evil.test' }, { origin: 'null' }, { origin: 'http://localhost:4320' },
    { 'sec-fetch-site': 'cross-site' },
  ]) assert.equal((await f.send('/', { headers })).status, 403);
  assert.equal((await f.send('/', { headers: { origin: f.origin } })).status, 200);
  for (const path of ['/api/ops/findings/finding/review', '/api/ops/findings/finding/dismiss',
    '/api/ops/findings/finding/fix-brief', '/api/ops/policies', '/api/agents',
    '/api/thelake/v1/llm/sessions/search', '/api/thelake/v1/llm/sessions/ses_local']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await f.send(path, { method, headers: { origin: f.origin, 'content-type': 'application/json' }, body: '{}' })).status, 403, `${method} ${path}`);
    }
  }
  assert.equal(f.calls.length, 0);
});
