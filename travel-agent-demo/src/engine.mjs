import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function engineEnvironment(root, base = process.env, password) {
  const env = { ...base };
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.SOFTPROBE_USER_ID;
  delete env.SPCODE_MODE;
  for (const key of Object.keys(env)) if (key.startsWith('OTEL_') || key.startsWith('SOFTPROBE_')) delete env[key];
  for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID']) delete env[key];
  return { ...env,
    OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '1024',
    XDG_CONFIG_HOME: join(root, '.runtime/config'),
    TMPDIR: join(root, '.runtime/tmp'),
    OPENCODE_CONFIG_DIR: join(root, '.opencode'),
    OPENCODE_CONFIG: join(root, 'opencode.json'),
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_SERVER_USERNAME: 'opencode',
  };
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = exited => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeout);
    child.once('exit', onExit);
  });
}

export class OpenCodeEngine {
  constructor({ root, password, internalToken, port = 4311, gatewayPort = 4310, fetchFn = fetch }) {
    Object.assign(this, { root, password, internalToken, port, gatewayPort, fetch: fetchFn });
  }

  async request(path, { method = 'GET', body, timeout = 180_000 } = {}) {
    const response = await this.fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`, 'Content-Type': 'application/json', 'x-opencode-directory': this.root },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`OpenCode returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`OpenCode HTTP ${response.status}: ${String(data?.message ?? data?.error?.message ?? data?.name ?? 'Request failed').slice(0, 200)}`);
    return data;
  }

  async start() {
    if (this.stopping) throw new Error('OpenCode startup was cancelled.');
    mkdirSync(join(this.root, '.runtime/config'), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.root, '.runtime/tmp'), { recursive: true, mode: 0o700 });
    const env = { ...engineEnvironment(this.root, process.env, this.password), TRAVEL_GATEWAY_URL: `http://127.0.0.1:${this.gatewayPort}/agent`, TRAVEL_INTERNAL_TOKEN: this.internalToken };
    this.child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(this.port)], { cwd: this.root, env, stdio: ['ignore', 'inherit', 'inherit'] });
    this.child.on('error', error => { this.spawnError = error; });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.stopping) throw new Error('OpenCode startup was cancelled.');
      if (this.spawnError) throw this.spawnError;
      if (this.child.exitCode !== null || this.child.signalCode !== null) throw new Error(`OpenCode exited during startup (${this.child.exitCode ?? this.child.signalCode}).`);
      try {
        const health = await this.request('/global/health', { timeout: 750 });
        if (health?.healthy && !this.stopping) return health;
      } catch { /* startup may still be loading local plugins */ }
      if (this.stopping) throw new Error('OpenCode startup was cancelled.');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await this.stop();
    throw new Error('OpenCode did not become ready within its startup window.');
  }

  stop({ graceMs = 2000, killMs = 2000 } = {}) {
    this.stopping = true;
    this.stopPromise ??= (async () => {
      const child = this.child;
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      if (await waitForExit(child, graceMs)) return;
      child.kill('SIGKILL');
      if (!await waitForExit(child, killMs)) throw new Error('OpenCode termination could not be confirmed; keep the runtime lock.');
    })();
    return this.stopPromise;
  }
}
