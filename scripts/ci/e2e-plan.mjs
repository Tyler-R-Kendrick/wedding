#!/usr/bin/env node
/**
 * The Playwright shard plan: which tests shard `i` of `n` runs. scripts/ci/e2e-shard.mjs runs a
 * shard; `node scripts/ci/e2e-plan.mjs <production|test-server> <n>` prints the plan's summary.
 *
 * Shards are filled by recorded time (tests/e2e/durations.json), longest first into the lightest
 * shard, so each takes about as long as the others. Playwright's own `--shard` deals tests out by
 * count, which put the site crawler's minutes next to forty one-second tests.
 *
 * The unit is one test in one project. A shard names its tests by full title (`--grep`), not by
 * `file:line`: tests declared in a loop share a line, and the crawler's eight longest tests are
 * two such loops. A file that declares a serial block stays whole within a project, because its
 * tests depend on the ones before them. A test with no recorded time (a new one) counts as the
 * median, and `npm run e2e:durations` records it.
 *
 * Every test is in exactly one shard for a given `n` (tests/unit/agent/ci-plan.test.ts), the
 * runner checks that Playwright selects exactly the tests the plan names, and
 * scripts/check-spec-coverage.mjs still holds every spec file to one of the two kinds.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_SPECS, TEST_SERVER_SPECS } from '../check-spec-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DURATIONS_FILE = 'tests/e2e/durations.json';
export const PROJECTS = ['mobile', 'desktop'];
export const KINDS = { production: PRODUCTION_SPECS, 'test-server': TEST_SERVER_SPECS };

/** Every test Playwright would run for these specs: `{ file, titles, project }`. */
export function listTests(specs, extra = []) {
  const out = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...specs, ...PROJECTS.map((p) => `--project=${p}`), ...extra], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: '' } });
  const tests = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests) tests.push({ file: `tests/${spec.file}`, titles: [...titles, spec.title], project: t.projectName });
    for (const child of suite.suites ?? []) walk(child, child.title && child.title !== suite.file ? [...titles, child.title] : titles);
  };
  for (const suite of JSON.parse(out).suites) walk(suite, []);
  return tests;
}

/** The key a test's time is recorded under. */
export const durationKey = (t) => `${t.project} | ${t.file} | ${t.titles.join(' › ')}`;

/** What Playwright matches `--grep` against for a test: project, file under tests/, then its titles. */
export const grepTitle = (t) => [t.project, t.file.replace(/^tests\//, ''), ...t.titles].join(' ');

/** A `--grep` that selects exactly these tests (a test's tags, if it has any, follow its title). */
export function grepFor(tests) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^(?:${tests.map((t) => escape(grepTitle(t))).join('|')})(?: @\\S+)*$`;
}

/**
 * Splits `tests` into `n` shards of about equal recorded time. Each shard is `{ seconds, tests }`,
 * its tests in a stable order.
 *
 * @param {{ file: string, titles: string[], project: string }[]} tests
 * @param {Record<string, number>} durations seconds by `durationKey`
 * @param {number} n
 * @param {(file: string) => boolean} isSerial whether a file's tests must stay together
 * @returns {{ seconds: number, tests: { file: string, titles: string[], project: string }[] }[]}
 */
export function plan(tests, durations, n, isSerial) {
  const known = tests.map((t) => durations[durationKey(t)]).filter((s) => typeof s === 'number').sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 5;
  const units = new Map();
  for (const t of tests) {
    const name = isSerial(t.file) ? `${t.project} | ${t.file}` : durationKey(t);
    const unit = units.get(name) ?? { name, seconds: 0, tests: [] };
    unit.seconds += durations[durationKey(t)] ?? fallback;
    unit.tests.push(t);
    units.set(name, unit);
  }
  /** @type {{ seconds: number, tests: { file: string, titles: string[], project: string }[] }[]} */
  const shards = Array.from({ length: n }, () => ({ seconds: 0, tests: [] }));
  // Longest first, each into the lightest shard so far. Ties break on the name, so the same inputs
  // always give the same shards.
  for (const unit of [...units.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))) {
    const lightest = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    lightest.tests.push(...unit.tests);
    lightest.seconds += unit.seconds;
  }
  for (const s of shards) s.tests.sort((a, b) => durationKey(a).localeCompare(durationKey(b)));
  return shards;
}

const serialFile = (file) => /mode:\s*'serial'/.test(readFileSync(path.join(ROOT, file), 'utf8'));

export function readDurations() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, DURATIONS_FILE), 'utf8'));
  } catch {
    return {};
  }
}

export const serial = serialFile;

/** The plan for a kind of spec (`production` or `test-server`) cut into `n` shards. */
export function planFor(kind, n) {
  return plan(listTests(KINDS[kind]), readDurations(), n, serialFile);
}

function main([kind, n]) {
  if (!KINDS[kind] || !(Number(n) >= 1)) {
    console.error('usage: e2e-plan.mjs <production|test-server> <n>');
    return 2;
  }
  planFor(kind, Number(n)).forEach((s, k) => console.log(`${k + 1}/${n}\t${Math.round(s.seconds)}s\t${s.tests.length} tests in ${new Set(s.tests.map((t) => t.file)).size} files`));
  return 0;
}

const runDirectly = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};
if (runDirectly()) process.exitCode = main(process.argv.slice(2));
