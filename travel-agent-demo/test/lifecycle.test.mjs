import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Offline startup fixture did not reach the expected stage.');
}

function startupFixture(t, { failHealth = true, pause = '', ignoreTerm = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'travel-startup-test-'));
  const src = join(root, 'src');
  mkdirSync(src);
  mkdirSync(join(root, '.runtime'));
  // Copy production code unchanged; dependencies below never call a live service.
  copyFileSync(new URL('../src/start.mjs', import.meta.url), join(src, 'start.mjs'));
  copyFileSync(new URL('../src/engine.mjs', import.meta.url), join(src, 'real-engine.mjs'));
  writeFileSync(join(src, 'fixture.mjs'), `
    import { appendFileSync, existsSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    export const event = name => appendFileSync('events', name + '\\n');
    export async function gate(name) {
      event(name);
      if (name === ${JSON.stringify(pause)}) while (!existsSync('release')) await delay(10);
    }
  `);
  writeFileSync(join(src, 'booking-store.mjs'), 'export class BookingStore {}');
  writeFileSync(join(src, 'engine.mjs'), `
    import { OpenCodeEngine as Engine } from './real-engine.mjs';
    import { existsSync } from 'node:fs';
    import { gate, event } from './fixture.mjs';
    export class OpenCodeEngine extends Engine {
      constructor(options) {
        super({ ...options, fetchFn: async url => {
          if (url.endsWith('/global/health')) {
            if (!existsSync('engine-ready')) return Response.json({ healthy: false });
            await gate('engine-health');
            return Response.json({ healthy: true, version: '1.18.30' });
          }
          await gate('config');
          return Response.json({ model: ${failHealth ? "'wrong'" : "'openai/gpt-4.1-mini'"}, plugin: [options.root + '/.opencode/plugins/travel-safety.ts'], permission: { '*': 'deny', 'travel_*': 'allow' } });
        } });
      }
      start() { event('engine-start'); return super.start(); }
      stop() { event('stop'); return super.stop({ graceMs: 800, killMs: 500 }).then(() => event('engine-exited-lock-' + existsSync('.runtime/server.lock'))); }
    }
  `);
  writeFileSync(join(src, 'server.mjs'), `
    import { EventEmitter } from 'node:events';
    import { event } from './fixture.mjs';
    export function createGateway() {
      event('gateway');
      return Object.assign(new EventEmitter(), {
        listen(port, host, callback) { event('listen'); queueMicrotask(callback); },
        close(callback) { event('close'); if (callback) queueMicrotask(callback); },
      });
    }
  `);
  // Only this disposable Node child can resolve as "opencode"; it binds no port.
  writeFileSync(join(root, 'opencode'), `#!${process.execPath}
    const fs = require('node:fs');
    process.on('SIGTERM', () => { fs.appendFileSync('events', 'term\\n'); ${ignoreTerm ? '' : 'process.exit(0);'} });
    fs.writeFileSync('engine-pid', String(process.pid));
    fs.writeFileSync('engine-ready', 'ready');
    setInterval(() => {}, 1000);
  `, { mode: 0o700 });
  const child = spawn(process.execPath, [join(src, 'start.mjs')], { cwd: root, env: { PATH: root, HOME: root, TMPDIR: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 6000, killSignal: 'SIGKILL' });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (existsSync(join(root, 'engine-pid'))) {
      try { process.kill(Number(readFileSync(join(root, 'engine-pid'), 'utf8')), 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  const events = () => existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8').trim().split('\n') : [];
  return { root, child, exited, events };
}

test('startup failure exits nonzero without relying on an unreferenced timer', async t => {
  const { root, exited } = startupFixture(t);
  const result = await exited;
  assert.match(result.stderr, /isolated travel-agent configuration/);
  assert.equal(result.signal, null);
  assert.equal(result.code, 1);
  assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
});

test('shutdown retains the writer lock until its uncooperative child really exits', async t => {
  const { root, child, exited, events } = startupFixture(t, { failHealth: false, ignoreTerm: true });
  await waitFor(() => events().includes('listen'));
  const pid = Number(readFileSync(join(root, 'engine-pid'), 'utf8'));
  child.kill('SIGTERM');
  await waitFor(() => events().includes('term'));
  assert.equal(process.kill(pid, 0), true);
  assert.equal(readFileSync(join(root, '.runtime/server.lock'), 'utf8'), String(child.pid));
  const result = await exited;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.ok(events().includes('close'));
  assert.ok(events().includes('engine-exited-lock-true'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
});

for (const phase of ['engine-health', 'config']) {
  test(`SIGTERM during ${phase} cancels startup without continuing or listening`, async t => {
    const { root, child, exited, events } = startupFixture(t, { failHealth: false, pause: phase });
    await waitFor(() => events().includes(phase));
    child.kill('SIGTERM');
    await waitFor(() => events().includes('stop'));
    writeFileSync(join(root, 'release'), 'continue');
    const result = await exited;
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(events().includes('gateway'), false);
    assert.equal(events().includes('listen'), false);
    if (phase === 'engine-health') assert.equal(events().includes('config'), false);
    assert.doesNotMatch(result.stdout, /Travel agent:/);
    assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
  });
}
