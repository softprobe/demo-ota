import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VercelAIEngine } from './engine.mjs';
import { BookingStore } from './booking-store.mjs';
import { TravelAPI } from './travel-api.mjs';
import { createGateway } from './server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, '.runtime');
const port = Number(process.env.TRAVEL_AGENT_PORT ?? 4310);
const host = process.env.TRAVEL_AGENT_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TRAVEL_AGENT_PORT must be a valid TCP port.');
const travel = new TravelAPI({ baseUrl: process.env.TRAVEL_OTA_BASE_URL ?? 'http://127.0.0.1:8080' });
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
const internalToken = randomBytes(32).toString('hex');
let softprobeClient;
const engine = new VercelAIEngine({ root, internalToken, gatewayPort: port });
let server;
let stopping = false;
let stopPromise;
function stop(code = 0) {
  process.exitCode = process.exitCode || code;
  stopping = true;
  stopPromise ??= (async () => {
    await Promise.all([
      engine.stop(),
      softprobeClient?.shutdown(),
      new Promise((resolve, reject) => {
        if (!server) return resolve();
        server.close(error => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
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
  const health = await engine.start();
  if (stopping) return;
  if (process.env.SOFTPROBE_PUBLIC_KEY && process.env.SOFTPROBE_BASE_URL) {
    const [{ registerTelemetry }, { SoftprobeClient }, { SoftprobeVercelAiSdkIntegration }] = await Promise.all([
      import('ai'),
      import('@softprobe/tracing'),
      import('@softprobe/vercel-ai-sdk'),
    ]);
    softprobeClient = SoftprobeClient.fromEnv({ serviceName: 'demo-ota-travel-agent' });
    registerTelemetry(new SoftprobeVercelAiSdkIntegration({ tracer: softprobeClient.tracer }));
  }
  if (stopping) return;
  server = createGateway({ root, engine, store, internalToken, travel, maxConversations: null, basePath: '/agent' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  if (stopping) return;
  console.log(`Travel OTA web app: http://127.0.0.1:${port}/`);
  console.log(`Travel agent: http://127.0.0.1:${port}/agent`);
  console.log(`Synthetic demo only. Configured model providers: ${health.providers.map(provider => provider.label).join(', ') || 'none'}. Bookings remain unpaid and require explicit confirmation.`);
}
try {
  await start();
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    await stop(1);
  } else await stop();
}
