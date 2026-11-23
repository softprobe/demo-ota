import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));
const skipLegacyRoot = args.has('--skip-legacy-root') || args.has('--allow-legacy');

const COMPOSE_FILE = /^(docker-)?compose.*\.(ya?ml)$/i;
const FORBIDDEN_TOKEN = /(@softprobe|softprobe|opentelemetry|sp-agent)/i;
const ALLOWED_HOST = /spair\.softprobe\.ai/gi;
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'target', 'dist', 'build', '.runtime']);
const IGNORED_FILES = new Set(['uv.lock']);
const TARGET_DIRS = ['apps', 'agents', 'services'];

const violations = [];

for (const entry of readdirSync(ROOT)) {
  if (!COMPOSE_FILE.test(entry)) continue;
  if (skipLegacyRoot && entry === 'compose.blackbox.yml') continue;
  violations.push(`${entry}: compose file is not allowed in repository root`);
}

let scannedFiles = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry) || IGNORED_FILES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const relPath = relative(ROOT, fullPath);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (COMPOSE_FILE.test(entry)) {
      violations.push(`${relPath}: compose file is not allowed`);
      continue;
    }
    const raw = readFileSync(fullPath);
    if (raw.includes(0)) continue;
    scannedFiles += 1;
    const lines = raw.toString('utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const scrubbed = line.replace(ALLOWED_HOST, '');
      const match = FORBIDDEN_TOKEN.exec(scrubbed);
      if (match) {
        violations.push(`${relPath}:${index + 1}: forbidden token "${match[0]}" in "${line.trim().slice(0, 120)}"`);
      }
    });
  }
}

const checkedDirs = TARGET_DIRS.filter(dir => existsSync(join(ROOT, dir)));
for (const dir of checkedDirs) {
  walk(join(ROOT, dir));
}

if (violations.length > 0) {
  console.error(`Uninstrumented-source check failed with ${violations.length} violation(s):`);
  for (const item of violations) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(
  `Uninstrumented-source check passed: scanned ${scannedFiles} file(s) across [${checkedDirs.join(', ')}]${skipLegacyRoot ? ' (legacy root compose skipped)' : ''}.`,
);
