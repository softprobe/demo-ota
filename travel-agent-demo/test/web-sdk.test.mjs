import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

async function waitFor(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Browser fixture did not reach the expected state.');
}

async function browser(t, savedSession) {
  const html = (await readFile(new URL('../public/index.html', import.meta.url), 'utf8')).replace('__SOFTPROBE_WEB_BASE_URL__', 'http://127.0.0.1:4310/api/telemetry');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:4310/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  let created = 0;
  Object.assign(window, { Request, Response, Headers, TextEncoder, TextDecoder });
  if (savedSession) window.sessionStorage.setItem('softprobe.travel.sessionId', savedSession);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const call = { path: url.pathname, method: options.method || 'GET', headers: new Headers(options.headers), body: options.body && JSON.parse(options.body) };
    calls.push(call);
    if (call.path.endsWith('/v1/traces')) return Response.json({ success: true, ingested_count: 1 });
    if (call.path === '/api/status') return Response.json({ ready: true, opencode: true, travel: true, traceLinking: true });
    if (call.path === '/api/sessions') return Response.json({ id: `ses_browser_${++created}` }, { status: 201 });
    if (call.path.endsWith('/messages')) return Response.json({ accepted: true }, { status: 202 });
    return Response.json({ id: call.path.split('/').at(-1), messages: [], busy: false, offers: [], pending: null, booking: null });
  };
  t.after(() => { window.__softprobeSession?.stop(); window.close(); });
  window.eval(await readFile(new URL('../public/telemetry-session.js', import.meta.url), 'utf8'));
  Object.defineProperty(window.document, 'currentScript', { value: window.document.querySelector('script[data-public-key]'), configurable: true });
  window.eval(await readFile(new URL('../node_modules/@softprobe/web/dist/softprobe-session.js', import.meta.url), 'utf8'));
  window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
  await waitFor(() => window.document.getElementById('connection-label').textContent === 'Connected');
  return { window, calls };
}

test('official Web SDK restores the conversation ID before app requests and records under that ID', async t => {
  const { window, calls } = await browser(t, 'ses_restored');
  assert.equal(window.__softprobeSession.enabled, true);
  assert.equal(window.__softprobeSession.sessionId, 'ses_restored');
  assert.equal(calls.find(c => c.path === '/api/status').headers.get('x-sp-session-id'), 'ses_restored');
  await window.__softprobeSession.flush();
  const spans = calls.filter(c => c.path.endsWith('/v1/traces')).flatMap(c => c.body.resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans)));
  assert.ok(spans.length);
  assert.ok(spans.every(s => s.attributes.find(a => a.key === 'sp.session.id').value.stringValue === 'ses_restored'));
});

test('new and subsequent conversations switch SDK headers before sending their first message', async t => {
  const { window, calls } = await browser(t);
  for (let i = 1; i <= 2; i += 1) {
    const input = window.document.getElementById('message-input');
    input.value = 'Offline browser fixture';
    input.dispatchEvent(new window.Event('input'));
    window.document.getElementById('composer').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await waitFor(() => calls.some(c => c.path === `/api/sessions/ses_browser_${i}/messages`));
    const message = calls.find(c => c.path === `/api/sessions/ses_browser_${i}/messages`);
    assert.equal(message.headers.get('x-sp-session-id'), `ses_browser_${i}`);
    assert.equal(window.sessionStorage.getItem('x-sp-session-id'), `ses_browser_${i}`);
    await waitFor(() => !window.document.getElementById('new-conversation').disabled);
    if (i === 1) window.document.getElementById('new-conversation').click();
  }
});
