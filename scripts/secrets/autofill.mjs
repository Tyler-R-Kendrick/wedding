#!/usr/bin/env node
// Fill .env with every value the sandbox can produce on its own (random secrets, local paths,
// detected binaries). Never prints values; never overwrites an existing non-empty value.
//   node scripts/secrets/autofill.mjs [--env .env] [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const args = process.argv.slice(2);
const envPath = (() => { const i = args.indexOf('--env'); return i >= 0 ? args[i + 1] : '.env'; })();
const dry = args.includes('--dry-run');
const rand = (bytes = 32) => randomBytes(bytes).toString('base64url');
const firstExisting = (...paths) => paths.find((p) => p && existsSync(p)) || '';

/** name → { value, why } — only when the value can be produced without any account. */
const AUTO = {
  CONFIRMATION_SECRET: { value: () => rand(32), why: 'HMAC secret for confirmation tokens' },
  CRON_SECRET: { value: () => rand(32), why: 'bearer for /api/jobs/run' },
  BETTER_AUTH_SECRET: { value: () => rand(32), why: 'Better Auth session signing' },
  TEST_AUTH_SECRET: { value: () => rand(24), why: 'test-only principal injector' },
  DEV_STORAGE_SECRET: { value: () => rand(32), why: 'HMAC for local signed storage URLs' },
  NEXT_PUBLIC_SITE_URL: { value: () => 'http://localhost:3000', why: 'local site origin' },
  BETTER_AUTH_URL: { value: () => 'http://localhost:3000', why: 'Better Auth base URL (local)' },
  EMAIL_FROM: { value: () => 'Sara + Tyler <no-reply@localhost>', why: 'dev inbox sender' },
  PW_CHROMIUM_PATH: { value: () => firstExisting('/opt/pw-browsers/chromium'), why: 'preinstalled Chromium for Playwright' },
  FFMPEG_PATH: { value: () => firstExisting('/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', '/usr/bin/ffmpeg'), why: 'ffmpeg for video keyframes' },
  ASSETS_USER_AGENT: { value: () => 'sara-tyler-wedding-site/0.1 (+https://github.com/Tyler-R-Kendrick/wedding)', why: 'Wikimedia/Openverse client UA' },
};

const existing = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
const present = new Map();
for (const line of existing.split('\n')) { const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line); if (m) present.set(m[1], m[2].trim()); }
const added = [], skipped = [];
const lines = [];
for (const [name, spec] of Object.entries(AUTO)) {
  if (present.has(name) && present.get(name) !== '' && present.get(name) !== '""') { skipped.push(name); continue; }
  const v = spec.value();
  if (!v) { skipped.push(name + ' (not detectable here)'); continue; }
  lines.push(`${name}=${/^[A-Za-z0-9_./:@+=,-]*$/.test(v) ? v : JSON.stringify(v)}`);
  added.push(name);
}
if (dry) { console.log('Would add:', added.join(', ') || '(nothing)'); if (skipped.length) console.log('Already set / skipped:', skipped.join(', ')); process.exit(0); }
if (lines.length) {
  const text = existing.replace(/\n*$/, existing ? '\n' : '') + `\n# auto-filled by scripts/secrets/autofill.mjs ${new Date().toISOString()} (generated locally, no accounts)\n` + lines.join('\n') + '\n';
  await writeFile(envPath, text, { mode: 0o600 });
}
console.log(`Auto-filled ${added.length} variable(s) in ${envPath}: ${added.join(', ') || '(nothing)'}`);
if (skipped.length) console.log(`Already set or not detectable: ${skipped.join(', ')}`);
