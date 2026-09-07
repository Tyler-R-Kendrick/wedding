#!/usr/bin/env node
/**
 * Every vitest project must be run by a CI step.
 *
 * `scripts/check-spec-coverage.mjs` makes this guarantee for Playwright specs, after a level-06
 * incident where three security suites skipped and reported green. Level 12 hit the same shape one
 * layer down: it added an `evals` project and put `npm run test:evals` inside `npm run verify`, but
 * the CI job runs the vitest projects one at a time and never calls `verify` — so the gate that
 * decides whether the concierge is grounded and safe executed on a developer's machine and nowhere
 * else. A project nobody runs is not a gate.
 */
import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

const CONFIG = 'vitest.config.ts';
const WORKFLOW = '.github/workflows/design-quality.yml';

function check() {
  const config = readFileSync(CONFIG, 'utf8');
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  const projects = [...config.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  if (projects.length === 0) {
    console.error(`No vitest projects found in ${CONFIG} — has the config changed shape?`);
    return 1;
  }

  // A project is covered when some npm script selects it AND the workflow runs that script.
  const scriptsRunningProject = (project) =>
    Object.entries(pkg.scripts ?? {})
      .filter(([, body]) => new RegExp(`--project[= ]${project}(\\s|$)`).test(body))
      .map(([name]) => name);

  const uncovered = projects.filter((project) => {
    const scripts = scriptsRunningProject(project);
    return !scripts.some((script) => workflow.includes(`npm run ${script}`));
  });

  if (uncovered.length) {
    console.error(
      `vitest projects run by no CI step:\n  ${uncovered.join('\n  ')}\n` +
        `  -> add an npm script that passes --project <name> and a step in ${WORKFLOW} that runs it.\n` +
        `     Being inside "npm run verify" is not enough: that job runs the projects individually.`,
    );
    return 1;
  }
  console.log(`vitest coverage ok: ${projects.length} projects (${projects.join(', ')}) each run by a CI step`);
  return 0;
}

if (argv[1] && import.meta.url.endsWith(argv[1].split('/').pop() ?? '')) process.exit(check());
export { check };
