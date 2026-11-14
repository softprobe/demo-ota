import { spawn } from 'node:child_process';

const docker = process.env.DOCKER_BIN || 'docker';
const image = process.env.DEMO_IMAGE;
if (!image) throw new Error('Set DEMO_IMAGE to the all-in-one demo image, such as demo-ota:local.');

async function run(command, args, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

try { await run(docker, ['info', '--format', '{{.ServerVersion}}'], 'ignore'); }
catch { throw new Error('Start Docker and wait for its engine to be ready, then run npm run demo again.'); }

const providerEnvironment = [
  'GEMINI_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'AI_COMPATIBLE_BASE_URL',
  'AI_COMPATIBLE_API_KEY',
  'TRAVEL_PROVIDER',
  'TRAVEL_MODEL',
];
const args = ['run', '--rm', '--init', '--publish', '127.0.0.1:8080:8080'];
for (const name of providerEnvironment) if (process.env[name]) args.push('--env', name);
args.push(image);

console.log('Travel OTA demo: http://127.0.0.1:8080/');
console.log('Travel agent: http://127.0.0.1:8080/agent');
await run(docker, args);
