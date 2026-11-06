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

function startupFixture(t, { failStart = false, pause = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'travel-startup-test-'));
  const src = join(root, 'src');
  mkdirSync(src);
  mkdirSync(join(root, '.runtime'));
  copyFileSync(new URL('../src/start.mjs', import.meta.url), join(src, 'start.mjs'));
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
    import { existsSync } from 'node:fs';
    import { gate, event } from './fixture.mjs';
    export class VercelAIEngine {
      constructor() {}
      async start() {
        await gate('engine-start');
        if (${failStart}) throw new Error('fixture model runtime startup failed');
        return { healthy: false, providers: [] };
      }
      async stop() { event('engine-stop-lock-' + existsSync('.runtime/server.lock')); }
    }
  `);
  writeFileSync(join(src, 'server.mjs'), `
    import { EventEmitter } from 'node:events';
    import { event } from './fixture.mjs';
    export function createGateway() {
      event('gateway');
      let keepAlive;
      return Object.assign(new EventEmitter(), {
        listen(port, host, callback) { event('listen'); keepAlive = setInterval(() => {}, 1000); queueMicrotask(callback); },
        close(callback) { event('close'); clearInterval(keepAlive); if (callback) queueMicrotask(callback); },
      });
    }
  `);
  const child = spawn(process.execPath, [join(src, 'start.mjs')], {
    cwd: root, env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir() }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = once(child, 'close').then(([code, signal]) => ({ code, signal, stdout, stderr }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  const events = () => existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8').trim().split('\n') : [];
  return { root, child, exited, events };
}

test('startup failure exits nonzero and releases the writer lock', async t => {
  const { root, exited, events } = startupFixture(t, { failStart: true });
  const result = await exited;
  assert.match(result.stderr, /fixture model runtime startup failed/);
  assert.equal(result.signal, null);
  assert.equal(result.code, 1);
  assert.equal(events().includes('gateway'), false);
  assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
});

test('shutdown closes the gateway before releasing its writer lock', async t => {
  const { root, child, exited, events } = startupFixture(t);
  await waitFor(() => events().includes('listen'));
  assert.equal(readFileSync(join(root, '.runtime/server.lock'), 'utf8'), String(child.pid));
  child.kill('SIGTERM');
  const result = await exited;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /Travel agent: http:\/\/127\.0\.0\.1:4310\/agent/);
  assert.ok(events().includes('close'));
  assert.ok(events().includes('engine-stop-lock-true'));
  assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
});

test('SIGTERM during model runtime startup prevents the gateway from listening', async t => {
  const { root, child, exited, events } = startupFixture(t, { pause: 'engine-start' });
  await waitFor(() => events().includes('engine-start'));
  child.kill('SIGTERM');
  await waitFor(() => events().includes('engine-stop-lock-true'));
  writeFileSync(join(root, 'release'), 'continue');
  const result = await exited;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(events().includes('gateway'), false);
  assert.equal(events().includes('listen'), false);
  assert.equal(existsSync(join(root, '.runtime/server.lock')), false);
});
