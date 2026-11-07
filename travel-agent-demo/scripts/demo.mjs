import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const docker = existsSync('/Applications/Docker.app/Contents/Resources/bin/docker') ? '/Applications/Docker.app/Contents/Resources/bin/docker' : 'docker';
async function run(command, args, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}
try { await run(docker, ['info', '--format', '{{.ServerVersion}}'], 'ignore'); }
catch { throw new Error('Start Docker and wait for its engine to be ready, then run npm run demo again.'); }
await run(docker, ['compose', '-f', join(root, 'compose.yaml'), 'up', '-d']);
let ready = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(1000) });
    if (response.ok) { ready = true; break; }
  } catch { /* a fresh Java container can take time to start */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('The synthetic OTA app did not become healthy. Inspect docker compose logs before retrying.');
await import('../src/start.mjs');
