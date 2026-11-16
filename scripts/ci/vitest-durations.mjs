#!/usr/bin/env node
/**
 * `npm run test:durations -- <report.json>…`: records how long each integration test file took,
 * from vitest JSON reports (`--reporter=json --outputFile=…`), into
 * tests/integration/durations.json. The shard plan (scripts/ci/vitest-plan.mjs) reads that file.
 * A file in no report keeps its recorded time; a file that no longer exists is dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesOf, readDurations, SUITES } from './vitest-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reports = process.argv.slice(2);
if (!reports.length) {
  console.error('usage: vitest-durations.mjs <report.json>…');
  process.exit(2);
}
const suite = 'integration';
const merged = readDurations(suite);
let seen = 0;
for (const file of reports) {
  for (const result of JSON.parse(readFileSync(file, 'utf8')).testResults ?? []) {
    const rel = path.relative(ROOT, result.name).split(path.sep).join('/');
    if (!rel.startsWith(`${SUITES[suite].dir}/`)) continue;
    merged[rel] = Math.round(((result.endTime - result.startTime) / 1000) * 10) / 10;
    seen++;
  }
}
const live = new Set(filesOf(suite));
const kept = Object.fromEntries(Object.entries(merged).filter(([f]) => live.has(f)).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(path.join(ROOT, SUITES[suite].durations), `${JSON.stringify(kept, null, 1)}\n`);
console.log(`${SUITES[suite].durations}: ${Object.keys(kept).length} files, ${seen} from ${reports.length} report${reports.length === 1 ? '' : 's'}`);
