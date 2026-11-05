import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const runtime = join(root, '.runtime');
mkdirSync(join(runtime, 'staging-web/js'), { recursive: true, mode: 0o700 });
const tokenFile = join(runtime, 'forwarder-token');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
if (!/^[0-9a-f]{64}$/.test(readFileSync(tokenFile, 'utf8').trim())) throw new Error('Invalid local forwarder capability; do not silently reset a running stack.');
for (const name of ['index.html', 'booking.html', 'orders.html', 'payment.html']) {
  const source = readFileSync(join(root, 'upstream/travel-ui-web', name), 'utf8');
  const page = source.replace(/data-base-url="[^"]*"/g, 'data-base-url="https://thelake-staging.softprobe.ai"').replace(/data-public-key="[^"]*"/g, 'data-public-key="home-demo"');
  writeFileSync(join(runtime, 'staging-web', name), page);
}
copyFileSync(join(root, 'upstream/travel-ui-web/softprobe-session.js'), join(runtime, 'staging-web/js/softprobe-session.js'));
const docker = existsSync('/Applications/Docker.app/Contents/Resources/bin/docker') ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
async function run(command, args, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio, env: { ...process.env, LOCAL_UID: String(process.getuid?.() ?? 501), LOCAL_GID: String(process.getgid?.() ?? 20) } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}
try { await run(docker, ['info', '--format', '{{.ServerVersion}}'], 'ignore'); }
catch { throw new Error('Open Docker Desktop and wait for its engine to start, then run npm run demo again.'); }
await run(docker, ['compose', '-f', join(root, 'compose.yaml'), 'up', '-d', '--build']);
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const results = await Promise.all(['http://127.0.0.1:8080/', 'http://127.0.0.1:4319/healthz'].map(url => fetch(url, { signal: AbortSignal.timeout(1000) })));
    if (results.every(response => response.ok)) { ready = true; break; }
  } catch { /* a fresh Java container can take time to start */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('The travel services did not become healthy. Inspect docker compose logs before retrying.');
await import('../src/start.mjs');
