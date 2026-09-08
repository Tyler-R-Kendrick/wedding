#!/usr/bin/env node
/**
 * `.env.example` is the only map anyone has of what this application reads from its environment.
 *
 * It is also the one artifact with nothing behind it: adding a variable to `src/lib/env.ts` and
 * forgetting the example file costs nothing at build time and everything at deploy time, when the
 * operator sets the variables they can see and the app boots without the one they cannot. This
 * check makes that a build failure instead.
 *
 * Three assertions:
 *   1. Every key in the server schema and every `NEXT_PUBLIC_*` the client inlines is documented.
 *   2. Every key documented is actually read, so the file cannot drift into fiction.
 *   3. No key is documented twice — a second entry silently overrides the first for anyone who
 *      copies the file, and `TEST_AUTH_SECRET` was listed twice when this was written.
 *
 * `NODE_ENV` and the operational/tooling variables in EXEMPT are read but deliberately not offered
 * as settings; each says why.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cwd, exit } from 'node:process';
import { join } from 'node:path';

const ROOT = cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Read but never a setting an operator chooses. Each entry is a decision, not an oversight.
 */
const EXEMPT = new Map([
  ['NODE_ENV', 'set by the runtime, never by hand — the app refuses several things when it is production'],
  ['CI', 'set by the CI provider'],
  ['VERCEL', 'set by the platform; used to default TRUSTED_PROXY_HOPS'],
  ['NEXT_PHASE', 'set by Next.js during the build'],
  ['NEXT_RUNTIME', 'set by Next.js (node vs edge)'],
  ['AWS_LAMBDA_FUNCTION_NAME', 'set by the platform; used to detect a read-only filesystem'],
  ['PATH', 'the shell'],
  ['HTTPS_PROXY', 'the environment, for the asset-fetch scripts'],
  ['NODE_USE_ENV_PROXY', 'set by the asset npm scripts themselves'],
  ['SECRETS_PRIVATE_KEY', 'Secret Drop private key — read from .secrets/, never from .env (docs/ops/secrets.md)'],
  ['SEED_TEST_FIXTURES', 'test-server arrangement only; set by the CI job and the local runners, never in a deployment'],
  ['PROBE_BASE', 'argument to a scripts/probes/* measurement script'],
  ['VW', 'local variable inside a browser-evaluated probe, not an environment read'],
  ['NEXT_PUBLIC_X', 'the literal example in the doc comment of src/lib/env.public.ts'],
]);

// ---- what the app reads -------------------------------------------------------------------
const envTs = read('src/lib/env.ts');
const serverSchema = /const serverSchema = z\.object\(\{([\s\S]*?)\n\}\)/.exec(envTs);
if (!serverSchema) {
  console.error('scripts/check-env-example.mjs: could not find `const serverSchema = z.object({ … })` in src/lib/env.ts.');
  exit(2);
}
const declared = new Set();
for (const m of serverSchema[1].matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)) declared.add(m[1]);

// Flags are FLAG_<NAME> / NEXT_PUBLIC_FLAG_<NAME>, derived from the flag registry rather than
// declared one by one; the example file documents the convention and the defaults.
const publicTs = read('src/lib/env.public.ts');
for (const m of publicTs.matchAll(/process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)/g)) declared.add(m[1]);

// ---- what the example file offers ---------------------------------------------------------
const example = read('.env.example');
const documented = new Map();
const duplicates = [];
for (const line of example.split('\n')) {
  // A commented-out setting is `# KEY=value` and nothing else. A comment that happens to mention
  // `KEY=1` mid-sentence is prose — that is how PGLITE_MEMORY read as a duplicate of itself.
  const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(\S*)\s*$/.exec(line);
  if (!m) continue;
  const key = m[2];
  if (documented.has(key)) duplicates.push(key);
  else documented.set(key, line);
}

/** Flag names as the registry declares them, for the derived FLAG_<NAME> variables. */
const flagNames = new Set([...read('src/contracts/flags.ts').matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]));

/**
 * Is this key named anywhere that could read it? `git grep` over tracked files, minus the example
 * file itself and the documentation that merely describes it.
 */
const referenced = (key) => {
  try {
    const hits = execFileSync('git', ['grep', '-l', '--fixed-strings', key, '--', '.'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => f !== '.env.example' && !f.endsWith('.md'));
    return hits.length > 0;
  } catch {
    return false; // git grep exits 1 when nothing matches
  }
};

const findings = [];
for (const key of [...declared].sort()) {
  if (!documented.has(key) && !EXEMPT.has(key)) findings.push(`${key} is read by the app and is NOT in .env.example`);
}
for (const key of [...documented.keys()].sort()) {
  if (declared.has(key)) continue;
  if (EXEMPT.has(key)) continue;
  // `FLAG_<NAME>` and `NEXT_PUBLIC_FLAG_<NAME>` are built from the flag name at runtime
  // (`src/contracts/flags.ts`), so no literal `FLAG_AI_CONCIERGE` exists to grep for. Documented
  // iff the flag itself is in the registry.
  const flag = /^(?:NEXT_PUBLIC_)?FLAG_([A-Z0-9_]+)$/.exec(key);
  if (flag) {
    if (flagNames.has(flag[1])) continue;
    findings.push(`${key} is documented in .env.example but ${flag[1]} is not a flag in src/contracts/flags.ts`);
    continue;
  }
  // Everything else: something in the repo has to name it. Scripts, config, workflows and
  // `.mcp.json` all count — a variable read only by the asset tooling is still a real setting.
  if (!referenced(key)) findings.push(`${key} is documented in .env.example but nothing in the repository reads it`);
}
for (const key of [...new Set(duplicates)].sort()) findings.push(`${key} appears more than once in .env.example`);

console.log(`${declared.size} variables read · ${documented.size} documented · ${EXEMPT.size} exempt by decision`);
if (findings.length === 0) {
  console.log('.env.example is complete and has no duplicates.');
  exit(0);
}
for (const f of findings) console.error(`  ${f}`);
console.error(`\n${findings.length} finding${findings.length === 1 ? '' : 's'}.`);
exit(1);
