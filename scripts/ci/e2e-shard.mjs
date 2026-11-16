#!/usr/bin/env node
/**
 * `node scripts/ci/e2e-shard.mjs <production|test-server> <i>/<n> [playwright options]`: runs shard
 * `i` of `n` of that kind's Playwright specs, as the CI matrix does.
 *
 * The plan (scripts/ci/e2e-plan.mjs) names the shard's tests; this passes them to Playwright as the
 * files they are in plus a `--grep` of their exact titles. Before running, it asks Playwright which
 * tests that selects and stops if the answer is not the plan's own list: a pattern that matched
 * one test too few would otherwise be a test no shard ran, and a green build.
 *
 * `production` runs against `next start` with the environment it is given (the workflow's);
 * `test-server` goes through scripts/test-server-specs.mjs, so the server settings stay in one place.
 * Both expect the build to exist.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { durationKey, grepFor, KINDS, listTests, planFor, PROJECTS } from './e2e-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [kind, shard, ...rest] = process.argv.slice(2);
const [, i, n] = /^(\d+)\/(\d+)$/.exec(shard ?? '') ?? [];
if (!KINDS[kind] || !i || Number(i) < 1 || Number(i) > Number(n)) {
  console.error('usage: e2e-shard.mjs <production|test-server> <i>/<n> [playwright options]');
  process.exit(2);
}

const mine = planFor(kind, Number(n))[Number(i) - 1];
console.log(`${kind} shard ${i}/${n}: ${mine.tests.length} tests, about ${Math.round(mine.seconds)}s of recorded test time`);
if (!mine.tests.length) process.exit(0);

const files = [...new Set(mine.tests.map((t) => t.file))];
const grep = grepFor(mine.tests);
const selected = listTests(files, ['--grep', grep]).map(durationKey).sort();
const planned = mine.tests.map(durationKey).sort();
if (selected.join('\n') !== planned.join('\n')) {
  const missing = planned.filter((k) => !selected.includes(k));
  const extra = selected.filter((k) => !planned.includes(k));
  console.error(`the shard's pattern does not select the shard's tests:\n  not selected: ${missing.join('\n    ') || 'none'}\n  selected but not planned: ${extra.join('\n    ') || 'none'}`);
  process.exit(1);
}

const select = [...files, '--grep', grep, ...PROJECTS.map((p) => `--project=${p}`), ...rest];
const command = kind === 'test-server' ? ['node', ['scripts/test-server-specs.mjs', '--no-build', ...select]] : ['npx', ['playwright', 'test', ...select]];
const run = spawnSync(command[0], command[1], { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
