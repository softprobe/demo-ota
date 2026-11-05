import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenCodeEngine } from '../src/engine.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(`${root}.runtime`, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString('hex');
const internalToken = randomBytes(32).toString('hex');
writeFileSync(`${root}.runtime/engine-access.json`, JSON.stringify({ password, internalToken }), { mode: 0o600 });
const engine = new OpenCodeEngine({ root, password, internalToken });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  stopping = true;
  try { await engine.stop(); } catch (error) { console.error(error.message); process.exitCode = 1; }
});
try {
  await engine.start();
  if (!stopping) console.log('Isolated OpenCode server ready on 127.0.0.1:4311; no model request sent.');
} catch (error) {
  if (!stopping) { console.error(error.message); process.exitCode = 1; }
  await engine.stop();
}
