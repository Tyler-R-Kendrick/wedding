#!/usr/bin/env node
/**
 * `node scripts/ci/reach.mjs <integration|e2e>`, as a workflow step: writes `run=true|false` to
 * the step's outputs. The rule itself is scripts/ci/affected.mjs.
 *
 * Anything short of a complete, confirmed list of the pull request's files runs the suite: another
 * event (push, merge queue), selection switched off (repository variable CI_SELECTION), a failed
 * request, or a list whose length is not the count GitHub reports for the pull request (the files
 * API stops at 3,000).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { affected, SUITES } from './affected.mjs';

const suite = process.argv[2];
if (!SUITES.includes(suite)) {
  console.error(`usage: reach.mjs <${SUITES.join('|')}>`);
  process.exit(2);
}

async function decide() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return [true, `event is ${process.env.GITHUB_EVENT_NAME}: the full suite runs`];
  if (process.env.CI_SELECTION !== 'on') return [true, 'selection is off (repository variable CI_SELECTION)'];
  const pull = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/pulls/${pull.number}/files?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [true, `could not list the pull request's files (${res.status})`];
    const batch = await res.json();
    // A rename changes two paths: the old one stops existing, which a suite can also depend on.
    for (const f of batch) files.push(f.filename, ...(f.previous_filename ? [f.previous_filename] : []));
    if (batch.length < 100) break;
  }
  const listed = new Set(files).size;
  if (listed < pull.changed_files) return [true, `listed ${listed} of the pull request's ${pull.changed_files} changed files`];
  const run = affected(suite, files);
  return [run, run ? `at least one of ${pull.changed_files} changed files can reach the ${suite} suite` : `none of ${pull.changed_files} changed files can reach the ${suite} suite: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ', …' : ''}`];
}

let run = true;
let why = '';
try {
  [run, why] = await decide();
} catch (error) {
  why = `selection failed (${error instanceof Error ? error.message : error}), so the suite runs`;
}
console.log(`${suite}: ${run ? 'run' : 'skip'}. ${why}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
