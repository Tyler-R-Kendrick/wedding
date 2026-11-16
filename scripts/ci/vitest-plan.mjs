#!/usr/bin/env node
/**
 * `node scripts/ci/vitest-plan.mjs integration <i>/<n>`: the test files shard `i` of `n` runs,
 * one per line, for `vitest run --project integration <files>`.
 *
 * Filled by recorded time (tests/integration/durations.json), longest file first into the lightest
 * shard. Vitest's own `--shard` deals files out by a hash of their path, which put the three
 * slowest files in one shard. A file with no recorded time counts as the median;
 * `npm run test:durations` records it. Every file is in exactly one shard
 * (tests/unit/agent/ci-plan.test.ts).
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SUITES = { integration: { dir: 'tests/integration', match: /\.test\.ts$/, durations: 'tests/integration/durations.json' } };

export function filesOf(suite) {
  const { dir, match } = SUITES[suite];
  return readdirSync(path.join(ROOT, dir), { recursive: true }).map(String).filter((f) => match.test(f)).map((f) => path.posix.join(dir, f.split(path.sep).join('/'))).sort();
}

export function readDurations(suite) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, SUITES[suite].durations), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * What every file costs before its first test: its own process, the app's modules, and a fresh
 * database with migrations and the seed. The report times only the tests, and over the 83 files
 * this start-up was 190 of 310 seconds, so a plan without it balances the smaller half.
 */
export const FILE_OVERHEAD_SECONDS = 2.3;

/** `n` lists of files of about equal recorded time. The same inputs always give the same lists. */
export function plan(files, durations, n, overhead = FILE_OVERHEAD_SECONDS) {
  const known = files.map((f) => durations[f]).filter((s) => typeof s === 'number').sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : 1;
  const cost = (file) => (durations[file] ?? fallback) + overhead;
  /** @type {{ seconds: number, files: string[] }[]} */
  const shards = Array.from({ length: n }, () => ({ seconds: 0, files: [] }));
  for (const file of [...files].sort((a, b) => cost(b) - cost(a) || a.localeCompare(b))) {
    const lightest = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best));
    lightest.files.push(file);
    lightest.seconds += cost(file);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

function main([suite, shard, flag]) {
  const [, i, n] = /^(\d+)\/(\d+)$/.exec(shard ?? '') ?? [];
  if (!SUITES[suite] || !i || Number(i) < 1 || Number(i) > Number(n)) {
    console.error('usage: vitest-plan.mjs integration <i>/<n> [--summary]');
    return 2;
  }
  const shards = plan(filesOf(suite), readDurations(suite), Number(n));
  if (flag === '--summary') {
    shards.forEach((s, k) => console.log(`${k + 1}/${n}\t${Math.round(s.seconds)}s\t${s.files.length} files`));
    return 0;
  }
  const mine = shards[Number(i) - 1];
  console.error(`${suite} shard ${i}/${n}: ${mine.files.length} files, about ${Math.round(mine.seconds)}s of recorded test time`);
  console.log(mine.files.join('\n'));
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
