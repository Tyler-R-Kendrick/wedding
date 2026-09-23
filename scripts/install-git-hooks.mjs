#!/usr/bin/env node
/**
 * Point this clone's git at the committed hooks in .githooks/ (the pre-commit design gate).
 *
 * Runs as `prepare`, so `npm install` / `npm ci` wire it with no extra step; `npm run hooks:install`
 * does it by hand. Never fails an install: outside a git work tree (a Vercel build, a tarball),
 * under CI, or when the clone already has its own hooksPath, it says why and leaves things alone.
 */
import { spawnSync } from 'node:child_process';

const HOOKS = '.githooks';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' });

if (process.env.CI) process.exit(0);
if (git('rev-parse', '--is-inside-work-tree').stdout?.trim() !== 'true') process.exit(0);

const current = git('config', '--local', '--get', 'core.hooksPath').stdout?.trim();
if (current && current !== HOOKS) {
  console.warn(`hooks: core.hooksPath is already "${current}"; left as is. The design gate lives in ${HOOKS}/pre-commit.`);
  process.exit(0);
}
if (current !== HOOKS) {
  const r = git('config', '--local', 'core.hooksPath', HOOKS);
  if (r.status !== 0) {
    console.warn(`hooks: could not set core.hooksPath (${r.stderr.trim()}); run \`git config core.hooksPath ${HOOKS}\`.`);
    process.exit(0);
  }
  console.log(`hooks: git now runs ${HOOKS}/pre-commit (design.md lint + impeccable detect) on every commit.`);
}
