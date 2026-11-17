#!/usr/bin/env node
/**
 * `node scripts/ci/affected.mjs <integration|e2e> < changed-files`: prints `true` when a pull
 * request's changed files can reach that suite, `false` when none of them can.
 *
 * Selection only narrows what a pull request waits for. The full suite still runs in the merge
 * queue and on main, and selection is off unless the repository variable CI_SELECTION is `on`
 * (turn it on with the merge queue, not before: without the queue nothing runs the full suite
 * until after the merge).
 *
 * The rule is a list of places a suite cannot read, not a guess at what it does read. A suite is
 * skipped only when EVERY changed file is in such a place; one file anywhere else, or an empty
 * list, runs it. So a change is hidden from a suite only by adding its path here, and
 * tests/unit/agent/ci-affected.test.ts pins the ones that must never be: a migration, seed
 * content, a stylesheet, the lockfile, a workflow, a config file, and any path not listed at all.
 *
 * Why not the import graph (`vitest related`, `nx affected`): these suites reach files without
 * importing them. Migrations are read from disk at boot, seed content is JSON, the browser specs
 * read the built app, and several tests read source files as text. A graph would call all of that
 * unreachable.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Read by nothing the app or its integration and browser suites load. PRODUCT.md is not here:
 * tests/e2e/links.spec.ts reads its route table.
 */
const INERT = [/^docs\//, /^(?!PRODUCT\.md$)[^/]+\.md$/, /^\.claude\//, /^\.impeccable\//, /^evals\//, /^tests\/unit\//, /^tests\/ui\//, /^tests\/contract\//, /^LICENSE$/];

/** Per suite: the other suite's own files, which this one never loads. */
const NOT_MINE = {
  integration: [/^tests\/e2e\//, /^tests\/security\//, /^tests\/a11y\.spec\.ts$/, /^playwright\.config\.ts$/, /^scripts\/ci\/e2e-[a-z]+\.mjs$/, /^scripts\/test-server-specs\.mjs$/, /^scripts\/check-spec-coverage\.mjs$/],
  e2e: [/^tests\/integration\//, /^tests\/evals\//, /^scripts\/ci\/vitest-[a-z]+\.mjs$/],
};

export const SUITES = Object.keys(NOT_MINE);

/**
 * Whether `suite` must run for these changed files.
 * @param {keyof typeof NOT_MINE} suite
 * @param {readonly string[]} changed repository-relative paths
 */
export function affected(suite, changed) {
  const unreachable = [...INERT, ...NOT_MINE[suite]];
  const files = changed.map((f) => f.trim()).filter(Boolean);
  // No list is no evidence: run.
  if (!files.length) return true;
  return files.some((file) => !unreachable.some((pattern) => pattern.test(file)));
}

const runDirectly = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (runDirectly()) {
  const suite = process.argv[2];
  if (!SUITES.includes(suite)) {
    console.error(`usage: affected.mjs <${SUITES.join('|')}> < changed-files`);
    process.exit(2);
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  console.log(String(affected(suite, input.split('\n'))));
}
