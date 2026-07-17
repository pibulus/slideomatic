// Stamps the current deploy's commit hash into sw.js's CACHE_VERSION so the
// service worker's fetch handler is guaranteed to change on every deploy —
// no build step exists otherwise, so there was nothing forcing the browser
// to notice new CSS/JS and evict its stale cache. Runs as the Netlify build
// command (see netlify.toml); COMMIT_REF is set by Netlify, falls back to
// local git or a timestamp so `npm run build` still works outside Netlify.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swPath = join(__dirname, '..', 'sw.js');

function resolveVersion() {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return `local-${Date.now()}`;
  }
}

const version = resolveVersion();
const sw = readFileSync(swPath, 'utf8');
const stamped = sw.replace(
  /const CACHE_VERSION = '[^']*';/,
  `const CACHE_VERSION = 'slideomatic-${version}';`
);

if (stamped === sw) {
  console.error('stamp-sw-version: CACHE_VERSION pattern not found in sw.js — nothing stamped');
  process.exit(1);
}

writeFileSync(swPath, stamped);
console.log(`stamp-sw-version: CACHE_VERSION -> slideomatic-${version}`);
