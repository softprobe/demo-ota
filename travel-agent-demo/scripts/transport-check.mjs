// Actual OpenCode/plugin transport test; noReply skips the model loop.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { loadTelemetryConfig } from '../src/telemetry-config.mjs';
const telemetry = loadTelemetryConfig();
const auth = JSON.parse(await readFile('.runtime/engine-access.json', 'utf8'));
const headers = { Authorization: `Basic ${Buffer.from(`opencode:${auth.password}`).toString('base64')}`, 'Content-Type': 'application/json', 'x-opencode-directory': process.cwd() };
async function request(path, body) {
  const response = await fetch(`http://127.0.0.1:4311${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`OpenCode diagnostic HTTP ${response.status}`);
  return data;
}
await request('/global/health');
const resume = process.argv.includes('--latest');
const session = resume
  ? (await request('/session')).filter(item => item.title === 'Transport diagnostic — no model request').sort((a, b) => b.time.created - a.time.created)[0]
  : await request('/session', { title: 'Transport diagnostic — no model request', agent: 'travel', model: { id: 'gpt-4.1-mini', providerID: 'openai' } });
assert.ok(session?.id, 'No transport diagnostic session found.');
console.log(`Checking diagnostic ${session.id} through ${telemetry.baseUrl}`);
if (!resume) {
  await request(`/session/${session.id}/message`, { noReply: true, agent: 'travel', model: { providerID: 'openai', modelID: 'gpt-4.1-mini' }, parts: [{ type: 'text', text: 'Telemetry transport diagnostic only. noReply=true: no model request or travel action is requested.' }] });
  assert.equal(await request(`/session/${session.id}/abort`, {}), true);
}
const messages = await request(`/session/${session.id}/message`);
assert.ok(messages.every(row => row.info.role === 'user'));
let data;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const response = await fetch(`${telemetry.baseUrl}/v1/llm/sessions/${session.id}`, { headers: { Authorization: `Bearer ${telemetry.publicKey}`, 'User-Agent': 'SoftprobeTravelDemo/0.1' }, signal: AbortSignal.timeout(15_000) });
  if (response.ok) { data = await response.json(); if (data.spans?.length >= 2) break; }
  else if (response.status !== 404) throw new Error(`Staging diagnostic read HTTP ${response.status}`);
  await new Promise(resolve => setTimeout(resolve, 1000));
}
assert.ok(data?.spans?.length >= 2, 'The real plugin events did not arrive in staging.');
assert.equal(data.span_count, data.spans.length);
const unique = new Set(data.spans.map(span => `${span.trace_id}:${span.span_id}`));
assert.equal(unique.size, data.spans.length, 'The exporter delivered duplicate span IDs.');
assert.equal(data.spans.filter(span => span.span_type === 'generation').length, 0);
const evidence = { sessionId: session.id, noReply: true, modelCalls: 0, reportedSpans: data.span_count, uniqueSpans: unique.size, duplicateRows: data.spans.length - unique.size, verified: true, observedAt: new Date().toISOString() };
await writeFile(`verification/transport-${session.id}.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
