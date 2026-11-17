#!/usr/bin/env node
/**
 * `node scripts/ci/e2e-shard.mjs <production|test-server> <i>/<n> [playwright options]`: runs shard
 * `i` of `n` of that kind's Playwright specs, as the CI matrix does.
 *
 * The plan (scripts/ci/e2e-plan.mjs) names the shard's tests; this passes them to Playwright as the
 * files they are in plus a `--grep` of their exact titles. It then holds Playwright to that list:
 * the tests the run reports must be exactly the plan's, or the shard fails. A pattern that matched
 * one test too few would otherwise be a test no shard selected, and a green build. The check is of
 * what was selected, not of each test's outcome: a test that skips itself (`test.skip`, as the
 * project skips do) is in the report and counts.
 *
 * `production` runs against `next start` with the environment it is given (the workflow's);
 * `test-server` goes through scripts/test-server-specs.mjs, so the server settings stay in one place.
 * Both expect the build to exist.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
console.log(`${kind} shard ${i}/${n}: ${mine.tests.length} tests, ${Math.round(mine.seconds)}s of recorded test time, expected to take about ${Math.round(mine.expected)}s`);
if (!mine.tests.length) process.exit(0);

const files = [...new Set(mine.tests.map((t) => t.file))];
const grep = grepFor(mine.tests);
const planned = mine.tests.map(durationKey).sort();

/** Stops the shard when the tests Playwright selected or ran are not the plan's own list. */
function mustBeThePlan(selected, when) {
  if (selected.join('\n') === planned.join('\n')) return;
  const missing = planned.filter((k) => !selected.includes(k));
  const extra = selected.filter((k) => !planned.includes(k));
  console.error(`this shard ${when} a different set of tests from its plan:\n  planned, not ${when}: ${missing.join('\n    ') || 'none'}\n  ${when}, not planned: ${extra.join('\n    ') || 'none'}`);
  process.exit(1);
}

// In CI the run writes a report of every test it selected (playwright.config.ts), and that report
// is checked below, after the run: the same guarantee without listing the tests a second time
// first, which cost each shard 3 to 4 seconds. Anywhere else there is no report, so ask first.
const REPORT = path.join(ROOT, 'test-results/report.json');
if (!process.env.CI) mustBeThePlan(listTests(files, ['--grep', grep]).map(durationKey).sort(), 'selected');

const select = [...files, '--grep', grep, ...PROJECTS.map((p) => `--project=${p}`), ...rest];
const command = kind === 'test-server' ? ['node', ['scripts/test-server-specs.mjs', '--no-build', ...select]] : ['npx', ['playwright', 'test', ...select]];
const run = spawnSync(command[0], command[1], { cwd: ROOT, stdio: 'inherit' });

if (process.env.CI) {
  const ran = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests) ran.push(durationKey({ file: `tests/${spec.file}`, titles: [...titles, spec.title], project: t.projectName }));
    for (const child of suite.suites ?? []) walk(child, child.title && child.title !== suite.file ? [...titles, child.title] : titles);
  };
  let report;
  try {
    report = JSON.parse(readFileSync(REPORT, 'utf8'));
  } catch {
    console.error(`no report at ${path.relative(ROOT, REPORT)}, so what this shard ran cannot be checked against its plan`);
    process.exit(run.status || 1);
  }
  for (const suite of report.suites ?? []) walk(suite, []);
  mustBeThePlan(ran.sort(), 'ran');
}
process.exit(run.status ?? 1);
