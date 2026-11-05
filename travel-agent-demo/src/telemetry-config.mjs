import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadTelemetryConfig(root = fileURLToPath(new URL('../', import.meta.url))) {
  const config = JSON.parse(readFileSync(join(root, '.runtime/softprobe.json'), 'utf8'));
  if (!/^spk_[A-Za-z0-9_-]+$/.test(config.publicKey ?? '') ||
      config.baseUrl !== 'https://explorer-staging.softprobe.ai/api/thelake' ||
      config.otlpEndpoint !== `${config.baseUrl}/v1/traces` || config.environment !== 'staging') {
    throw new Error('Configure a staging workspace agent key and Explorer gateway in .runtime/softprobe.json.');
  }
  return config;
}
