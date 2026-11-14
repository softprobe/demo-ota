import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuredProviders, defaultModelSelection, VercelAIEngine } from '../src/engine.mjs';

test('provider discovery accepts GEMINI_KEY without exposing credentials', () => {
  const env = { GEMINI_KEY: 'gemini-key-secret' };
  const providers = configuredProviders(env);
  assert.deepEqual(providers.map(provider => provider.id), ['google']);
  assert.equal(JSON.stringify(providers).includes('gemini-key-secret'), false);
  assert.deepEqual(defaultModelSelection(env), { provider: 'google', model: 'gemini-3.8-flash' });
});

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
  assert.match(modelCall.system, /If you previously asked for a year and the user repeats the month\/day, treat it as the answer/);
  assert.match(modelCall.system, /Search at most once per user travel request/);
  assert.match(modelCall.system, /After travel_prepare succeeds, stop using tools/);
  assert.equal(modelCall.messages.at(-1).content, 'LHR to FRA, Dec 18th');
  assert.deepEqual(Object.keys(modelCall.tools), ['travel_search', 'travel_prepare', 'travel_book', 'travel_order']);
  assert.deepEqual(modelCall.activeTools, ['travel_search', 'travel_prepare', 'travel_book', 'travel_order']);
  assert.equal(modelCall.stopWhen[1]({ steps: [{ toolResults: [{ toolName: 'travel_prepare' }] }] }), true);
  assert.equal(modelCall.stopWhen[1]({ steps: [{ toolResults: [{ toolName: 'travel_search' }] }] }), false);
  assert.equal(engine.sessions.get(session.id).provider, 'google');
  await engine.stop();
});

test('a selected offer removes search from the model toolset until preparation succeeds', async t => {
  const root = mkdtempSync(join(tmpdir(), 'travel-selected-offer-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  let prepare = false;
  const engine = new VercelAIEngine({
    root,
    internalToken: 'test-capability',
    env: { GOOGLE_GENERATIVE_AI_API_KEY: 'fixture-google-key' },
    generateTextFn: async options => {
      calls.push(options);
      return {
        text: '',
        steps: prepare ? [{ toolCalls: [{ toolName: 'travel_prepare' }], toolResults: [{ toolName: 'travel_prepare', output: { id: 'review-1' } }] }] : [],
        response: { messages: [{ role: 'assistant', content: 'Please provide the traveler’s first and last name.' }] },
      };
    },
  });
  const session = await engine.request('/session', { method: 'POST', body: { provider: 'google', model: 'gemini-3.8-flash' } });
  await engine.request(`/session/${session.id}/message`, { method: 'POST', body: { parts: [{ type: 'text', text: 'I would like to review offer offer-1.' }], selectedOfferId: 'offer-1' } });
  assert.deepEqual(calls[0].activeTools, ['travel_prepare', 'travel_book', 'travel_order']);
  assert.equal(engine.sessions.get(session.id).selectedOfferId, 'offer-1');
  prepare = true;
  await engine.request(`/session/${session.id}/message`, { method: 'POST', body: { parts: [{ type: 'text', text: 'Alex Demo' }], selectedOfferId: 'offer-1' } });
  assert.deepEqual(calls[1].activeTools, ['travel_prepare', 'travel_book', 'travel_order']);
  assert.equal(engine.sessions.get(session.id).selectedOfferId, null);
  await engine.request(`/session/${session.id}/message`, {
    method: 'POST', body: { parts: [{ type: 'text', text: 'User confirmed this exact booking.' }], allowedTools: ['travel_book', 'travel_order'] },
  });
  assert.deepEqual(calls[2].activeTools, ['travel_book', 'travel_order']);
  await engine.stop();
});

test('successful preparation stops the model tool loop and returns a concise review message', async t => {
  const root = mkdtempSync(join(tmpdir(), 'travel-prepare-stop-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let modelCall;
  const engine = new VercelAIEngine({
    root,
    internalToken: 'test-capability',
    env: { GOOGLE_GENERATIVE_AI_API_KEY: 'fixture-google-key' },
    generateTextFn: async options => {
      modelCall = options;
      return {
        text: '',
        steps: [{ toolCalls: [{ toolName: 'travel_prepare' }], toolResults: [{ toolName: 'travel_prepare', output: { id: 'review-1' } }] }],
        response: { messages: [{ role: 'assistant', content: 'tool result' }] },
      };
    },
  });
  const session = await engine.request('/session', { method: 'POST', body: { provider: 'google', model: 'gemini-3.8-flash' } });
  await engine.request(`/session/${session.id}/message`, { method: 'POST', body: { parts: [{ type: 'text', text: 'Alex Demo' }] } });
  assert.equal(modelCall.stopWhen[1]({ steps: [{ toolResults: [{ toolName: 'travel_prepare' }] }] }), true);
  assert.equal(engine.sessions.get(session.id).messages.at(-1).parts.at(-1).text, 'The review is ready in the trip panel.');
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
