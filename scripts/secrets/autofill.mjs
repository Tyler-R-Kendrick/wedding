#!/usr/bin/env node
/**
 * Fill .env with everything the sandbox can produce on its own — random secrets, values
 * derived from the repo and git identity, binaries found on this machine. No account is
 * involved, so none of this belongs on the Secret Drop page.
 *
 *   node scripts/secrets/autofill.mjs [--env .env] [--dry-run] [--force]
 *
 * The list lives in scripts/secrets/registry.mjs (AUTOFILL) so the page, the ladder and
 * this command always agree on what a human is never asked for. Existing non-empty values
 * are left alone unless --force. Prints names, never values.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { AUTOFILL } from './registry.mjs';
import { readEnv, parseDotenv, presentNames, applyEnv } from './env-file.mjs';
import { ENV_PATH } from './store.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const envPath = opt('env', ENV_PATH);
const dry = args.includes('--dry-run');
const force = args.includes('--force');

const gitConfig = (key) => { try { return execFileSync('git', ['config', '--get', key], { encoding: 'utf8' }).trim(); } catch { return ''; } };

const text = await readEnv(envPath);
const current = parseDotenv(text);
const present = presentNames(text);
const values = new Map();
const skipped = [];

for (const [name, spec] of Object.entries(AUTOFILL)) {
  if (present.has(name) && !force) { skipped.push(name); continue; }
  let value = '';
  switch (spec.method) {
    case 'generate':
      value = randomBytes(spec.bytes || 32).toString('base64url');
      break;
    case 'detect':
      value = spec.paths.find((p) => existsSync(p)) || '';
      break;
    case 'derive':
      if (spec.from) value = values.get(spec.from) || current.get(spec.from) || spec.value || '';
      else if (spec.git) value = gitConfig(spec.git);
      else value = spec.value || '';
      break;
    default:
      value = '';
  }
  if (value) values.set(name, value);
  else skipped.push(`${name} (not available here)`);
}

if (dry) {
  console.log('Would set:', [...values.keys()].join(', ') || '(nothing)');
  if (skipped.length) console.log('Already set or unavailable:', skipped.join(', '));
  process.exit(0);
}

const { updated, added } = values.size
  ? await applyEnv(values, { path: envPath, note: 'scripts/secrets/autofill.mjs (generated locally, no accounts)' })
  : { updated: [], added: [] };

console.log(`Auto-filled ${values.size} variable(s) in ${envPath}: added=[${added.join(', ')}] updated=[${updated.join(', ')}]`);
if (skipped.length) console.log(`Already set or unavailable: ${skipped.join(', ')}`);
