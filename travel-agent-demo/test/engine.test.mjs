import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredProviders, defaultModelSelection, VercelAIEngine } from '../src/engine.mjs';

test('provider discovery returns configured choices without exposing credentials', () => {
  const env = {
    GOOGLE_GENERATIVE_AI_API_KEY: 'google-test-secret',
    AI_GATEWAY_API_KEY: 'gateway-test-secret',
    OPENAI_API_KEY: '',
  };
  const providers = configuredProviders(env);
  assert.deepEqual(providers.map(provider => provider.id), ['google', 'gateway']);
  assert.equal(JSON.stringify(providers).includes('test-secret'), false);
  assert.deepEqual(defaultModelSelection(env), { provider: 'google', model: 'gemini-3.8-flash' });
  assert.deepEqual(defaultModelSelection({ ...env, TRAVEL_PROVIDER: 'gateway', TRAVEL_MODEL: 'google/gemini-3.8-flash' }), {
    provider: 'gateway', model: 'google/gemini-3.8-flash',
  });
});

test('Vercel AI model requests include current date and infer yearless month/day dates', async t => {
  const root = mkdtempSync(join(tmpdir(), 'travel-vercel-ai-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let modelCall;
  const engine = new VercelAIEngine({
    root,
    internalToken: 'test-capability',
    env: { GOOGLE_GENERATIVE_AI_API_KEY: 'fixture-google-key' },
    now: () => new Date('2026-11-06T12:00:00.000Z'),
    generateTextFn: async options => {
      modelCall = options;
      return { text: 'Searching for 2026-12-18.', steps: [], response: { messages: [{ role: 'assistant', content: 'Searching for 2026-12-18.' }] } };
    },
  });
  const session = await engine.request('/session', { method: 'POST', body: { provider: 'google', model: 'gemini-3.8-flash' } });
  await engine.request(`/session/${session.id}/message`, { method: 'POST', body: { parts: [{ type: 'text', text: 'LHR to FRA, Dec 18th' }] } });

  assert.match(modelCall.system, /Current date \(UTC\): 2026-11-06/);
  assert.match(modelCall.system, /infer the first occurrence strictly after today's date/);
  assert.match(modelCall.system, /If you previously asked for a year and the user repeats the month and day, treat that as the answer and proceed/);
  assert.equal(modelCall.messages.at(-1).content, 'LHR to FRA, Dec 18th');
  assert.deepEqual(Object.keys(modelCall.tools), ['travel_search', 'travel_prepare', 'travel_book', 'travel_order']);
  assert.equal(engine.sessions.get(session.id).provider, 'google');
  await engine.stop();
});

test('invalid, unconfigured, and malformed model selections are rejected', () => {
  const engine = new VercelAIEngine({ root: '/unused', env: { GOOGLE_GENERATIVE_AI_API_KEY: 'fixture' } });
  assert.throws(() => engine.resolveSelection('openai', 'gpt-4.1-mini'), /Configure the OpenAI API key/);
  assert.throws(() => engine.resolveSelection('unknown', 'model'), /supported model provider/);
  assert.throws(() => engine.resolveSelection('google', ' model with spaces '), /valid model ID/);
  assert.throws(() => engine.resolveSelection('google', '../unsafe'), /valid model ID/);
  assert.deepEqual(engine.resolveSelection(), { provider: 'google', model: 'gemini-3.8-flash' });
});
