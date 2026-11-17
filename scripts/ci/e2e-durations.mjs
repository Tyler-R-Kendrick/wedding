#!/usr/bin/env node
/**
 * `npm run e2e:durations -- <report.json>…`: records how long each Playwright test took, from one
 * or more JSON reports (`--reporter=json`), into tests/e2e/durations.json. The shard plan
 * (scripts/ci/e2e-plan.mjs) reads that file.
 *
 * Each CI shard uploads its report as an artifact; download a run's reports and pass them all. A
 * test in several reports keeps its longest time, and a test in none keeps what was recorded
 * before, so a partial run never forgets the rest. Tests that no longer exist are dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATIONS_FILE, durationKey, KINDS, listTests, readDurations } from './e2e-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Seconds by `durationKey` for every test in a Playwright JSON report that ran. */
export function durationsOf(report) {
  const seconds = {};
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        const ran = t.results.filter((r) => r.status !== 'skipped');
        if (!ran.length) continue;
        const key = durationKey({ project: t.projectName, file: `tests/${spec.file}`, titles: [...titles, spec.title] });
        seconds[key] = Math.max(seconds[key] ?? 0, ran.reduce((sum, r) => sum + r.duration, 0) / 1000);
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title && child.title !== suite.file ? [...titles, child.title] : titles);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return seconds;
}

const reports = process.argv.slice(2);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!reports.length) {
    console.error('usage: e2e-durations.mjs <report.json>…');
    process.exit(2);
  }
  const merged = readDurations();
  const fresh = {};
  for (const file of reports) for (const [k, s] of Object.entries(durationsOf(JSON.parse(readFileSync(file, 'utf8'))))) fresh[k] = Math.max(fresh[k] ?? 0, s);
  Object.assign(merged, fresh);
  const live = new Set(Object.values(KINDS).flatMap((specs) => listTests(specs)).map(durationKey));
  const kept = Object.fromEntries(Object.entries(merged).filter(([k]) => live.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, s]) => [k, Math.round(s * 10) / 10]));
  writeFileSync(path.join(ROOT, DURATIONS_FILE), `${JSON.stringify(kept, null, 1)}\n`);
  console.log(`${DURATIONS_FILE}: ${Object.keys(kept).length} tests, ${Object.keys(fresh).length} from ${reports.length} report${reports.length === 1 ? '' : 's'}`);
}
