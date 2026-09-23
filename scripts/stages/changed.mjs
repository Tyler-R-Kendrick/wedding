#!/usr/bin/env node
/**
 * Should this stage's deployment build? Vercel's `ignoreCommand` contract: exit 1 = build, 0 = skip.
 *
 *   node scripts/stages/changed.mjs <stage> [base-ref]
 *
 * Builds when any input of the stage (scripts/stages/inputs.mjs) changed since the last deployed
 * commit (`VERCEL_GIT_PREVIOUS_SHA`, or the given base ref), and whenever that cannot be known —
 * a first deployment, a shallow clone without the base. Skipping is the only thing it can get
 * wrong, so every doubt builds.
 */
import { spawnSync } from 'node:child_process';
import { affects, INPUTS } from './inputs.mjs';

const [stage, baseArg] = process.argv.slice(2);
if (!stage || !INPUTS[stage]) {
  console.error(`usage: node scripts/stages/changed.mjs <${Object.keys(INPUTS).join('|')}> [base-ref]`);
  process.exit(1);
}

const base = baseArg || process.env.VERCEL_GIT_PREVIOUS_SHA;
if (!base) {
  console.log(`${stage}: no previous deployment to compare with; building.`);
  process.exit(1);
}
const diff = spawnSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' });
if (diff.status !== 0) {
  console.log(`${stage}: cannot diff against ${base} (${diff.stderr.trim() || 'unknown error'}); building.`);
  process.exit(1);
}
const files = diff.stdout.split('\n').filter(Boolean);
if (affects(stage, files)) {
  console.log(`${stage}: inputs changed since ${base.slice(0, 7)}; building.`);
  process.exit(1);
}
console.log(`${stage}: nothing it reads changed since ${base.slice(0, 7)}; skipping.`);
process.exit(0);
