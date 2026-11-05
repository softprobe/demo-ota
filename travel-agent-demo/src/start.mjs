import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { OpenCodeEngine } from './engine.mjs';
import { BookingStore } from './booking-store.mjs';
import { createGateway } from './server.mjs';
import { TraceRegistrar } from './trace-registrar.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.runtime');
mkdirSync(runtime, { recursive: true, mode: 0o700 });
mkdirSync(join(runtime, 'tmp'), { recursive: true, mode: 0o700 });
const lockPath = join(runtime, 'server.lock');
if (existsSync(lockPath)) {
  const pid = Number(readFileSync(lockPath, 'utf8'));
  let alive = false;
  if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch { /* stale owned lock */ } }
  if (alive) throw new Error(`The travel demo already has a running process (${pid}). Use its existing window or stop it first.`);
  unlinkSync(lockPath);
}
writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
const password = randomBytes(32).toString('hex');
const internalToken = randomBytes(32).toString('hex');
writeFileSync(join(runtime, 'engine-access.json'), JSON.stringify({ password, internalToken }), { mode: 0o600 });
const engine = new OpenCodeEngine({ root, password, internalToken });
let server;
let explorerDemoServer;
let stopping = false;
let stopPromise;
function stop(code = 0) {
  process.exitCode = process.exitCode || code;
  stopping = true;
  stopPromise ??= (async () => {
    await Promise.all([
      engine.stop(),
      new Promise((resolve, reject) => {
        if (!server) return resolve();
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      }),
      new Promise((resolve, reject) => {
        if (!explorerDemoServer) return resolve();
        explorerDemoServer.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      }),
    ]);
    try {
      if (readFileSync(lockPath, 'utf8') === String(process.pid)) unlinkSync(lockPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })().catch(error => {
    process.exitCode = 1;
    console.error(error.message);
  });
  return stopPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop());
async function start() {
  if (stopping) return;
  const store = new BookingStore({ filePath: join(runtime, 'bookings.json') });
  const registrar = new TraceRegistrar({ token: readFileSync(join(runtime, 'forwarder-token'), 'utf8').trim() });
  const forwarderReady = await registrar.health();
  if (stopping) return;
  if (!forwarderReady) throw new Error('The local Session forwarder is not ready. Start the Docker stack first.');
  const health = await engine.start();
  if (stopping) return;
  if (health.version !== '1.18.30') throw new Error(`OpenCode ${health.version} requires re-verification; this demo was checked on 1.18.30.`);
  const config = await engine.request('/config', { timeout: 10_000 });
  if (stopping) return;
  if (config.model !== 'openai/gpt-4.1-mini' || config.plugin?.length !== 1 || !config.plugin[0].endsWith('/.opencode/plugins/tracing.ts') || config.permission?.['*'] !== 'deny' || config.permission?.['travel_*'] !== 'allow') throw new Error('Isolated travel-agent configuration did not match the expected safety boundaries.');
  let explorerBaseUrl = process.env.EXPLORER_BASE_URL || 'https://explorer-staging.softprobe.ai';
  const explorerConfigPath = join(runtime, 'explorer-demo.json');
  const explorerClientPath = join(runtime, 'explorer-client');
  if (!process.env.EXPLORER_BASE_URL && existsSync(explorerConfigPath) && existsSync(join(explorerClientPath, 'index.html'))) {
    const { createExplorerDemoServer } = await import('./explorer-demo-proxy.mjs');
    const explorerConfig = JSON.parse(readFileSync(explorerConfigPath, 'utf8'));
    explorerDemoServer = createExplorerDemoServer({ ...explorerConfig, root, clientDir: explorerClientPath });
    await new Promise((resolve, reject) => { explorerDemoServer.once('error', reject); explorerDemoServer.listen(4320, '127.0.0.1', resolve); });
    if (stopping) return;
    if (!process.env.EXPLORER_BASE_URL) explorerBaseUrl = 'http://127.0.0.1:4320';
  }
  server = createGateway({ root, engine, store, internalToken, registrar, maxConversations: null, explorerBaseUrl, demoQuery: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4310, '127.0.0.1', resolve); });
  if (stopping) return;
  console.log('Travel chat ready: http://127.0.0.1:4310');
  if (explorerDemoServer) console.log('Read-only Softprobe Explorer demo ready: http://127.0.0.1:4320');
  console.log('Staging only. No conversation or turn-count test caps. Booking approval and per-request safeguards remain.');
}
try {
  await start();
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    await stop(1);
  } else await stop();
}
