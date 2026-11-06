import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineEnvironment, OpenCodeEngine } from '../src/engine.mjs';

async function nodeChild(t, source) {
  const child = spawn(process.execPath, ['-e', `${source}\nsetInterval(() => {}, 1000); process.send('ready');`], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  });
  await once(child, 'message', { signal: AbortSignal.timeout(3000) });
  return child;
}

function startupEngine(t, fetchFn) {
  const root = mkdtempSync(join(tmpdir(), 'travel-engine-test-'));
  // PATH contains only this Node fixture: never run an installed OpenCode.
  writeFileSync(join(root, 'opencode'), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = root;
  const engine = new OpenCodeEngine({ root, fetchFn });
  t.after(async () => {
    if (engine.child?.pid && engine.child.exitCode === null && engine.child.signalCode === null) {
      const exited = once(engine.child, 'exit');
      engine.child.kill('SIGKILL');
      await exited;
    }
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  });
  return engine;
}

test('engine isolates its OpenCode config while retaining the existing auth data home', () => {
  const env = engineEnvironment('/project/demo', { HOME: '/home/example', PATH: '/bin', SOFTPROBE_BASE_URL: 'https://unused.invalid', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://unused.invalid', XDG_DATA_HOME: '/existing-auth', OPENCODE_CONFIG_CONTENT: 'production override' }, 'local-test-password');
  assert.equal(env.SOFTPROBE_BASE_URL, undefined);
  assert.equal(env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
  assert.equal(env.XDG_CONFIG_HOME, '/project/demo/.runtime/config');
  assert.equal(env.OPENCODE_CONFIG_DIR, '/project/demo/.opencode');
  assert.equal(env.XDG_DATA_HOME, '/existing-auth');
  assert.equal(env.OPENCODE_SERVER_PASSWORD, 'local-test-password');
  assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined);
});

test('engine caps output and excludes ambient OpenAI overrides without changing the caller environment', () => {
  const providerKeys = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'];
  const base = { HOME: '/home/example', XDG_DATA_HOME: '/existing-auth', OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '99999', ...Object.fromEntries(providerKeys.map(key => [key, 'ambient-override'])) };
  const original = { ...base };
  const env = engineEnvironment('/project/demo', base, 'local-test-password');
  assert.equal(env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX, '1024');
  for (const key of providerKeys) assert.equal(Object.hasOwn(env, key), false, key);
  assert.equal(env.HOME, base.HOME);
  assert.equal(env.XDG_DATA_HOME, base.XDG_DATA_HOME);
  assert.deepEqual(base, original);
});

test('engine stop is awaitable and resolves only after its child exits', async t => {
  const engine = new OpenCodeEngine({ root: '/unused' });
  engine.child = await nodeChild(t, "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));");
  const stopping = engine.stop();
  assert.equal(typeof stopping?.then, 'function');
  assert.equal(engine.child.exitCode, null);
  await stopping;
  assert.equal(engine.child.exitCode, 0);
  await engine.stop();
});

test('engine stop escalates an uncooperative owned child without touching another process', async t => {
  const engine = new OpenCodeEngine({ root: '/unused' });
  engine.child = await nodeChild(t, "process.on('SIGTERM', () => process.send('SIGTERM'));");
  const unrelated = await nodeChild(t, '');
  const received = [];
  engine.child.on('message', message => received.push(message));
  let timer;
  t.after(() => clearTimeout(timer));
  const result = await Promise.race([
    engine.stop({ graceMs: 50, killMs: 500 }).then(() => 'stopped'),
    new Promise(resolve => { timer = setTimeout(() => resolve('deadline exceeded'), 1500); }),
  ]);
  assert.equal(result, 'stopped');
  assert.deepEqual(received, ['SIGTERM']);
  assert.equal(engine.child.signalCode, 'SIGKILL');
  assert.equal(unrelated.exitCode, null);
  assert.equal(unrelated.signalCode, null);
  assert.equal(process.kill(unrelated.pid, 0), true);
});

test('engine startup rejects late readiness after stop without continuing its health loop', async t => {
  const requested = Promise.withResolvers();
  const health = Promise.withResolvers();
  let requests = 0;
  const engine = startupEngine(t, () => { requests += 1; requested.resolve(); return health.promise; });
  const starting = assert.rejects(engine.start(), /stopp|cancel/i);
  await requested.promise;
  await engine.stop();
  health.resolve(Response.json({ healthy: true }));
  await starting;
  assert.equal(requests, 1);
});

test('engine stopped before startup never spawns a child', async t => {
  const engine = startupEngine(t, () => assert.fail('Stopped engine must not poll health.'));
  await engine.stop();
  await assert.rejects(engine.start(), /stopp|cancel/i);
  assert.equal(engine.child, undefined);
});
