#!/usr/bin/env node
/**
 * Point this clone's git at the committed hooks in .githooks/ (the pre-commit design gate).
 *
 * Runs as `prepare`, so `npm install` / `npm ci` wire it with no extra step; `npm run hooks:install`
 * does it by hand, and a Claude Code SessionStart hook runs it too. Never fails an install, and never
 * silently displaces hooks someone already relies on. It leaves things alone, saying why, when:
 *   - `CI` is set, or this is not a git work tree (a Vercel build, a tarball);
 *   - `git config hooks.designGate false` opted this clone out (survives every later run);
 *   - core.hooksPath is already set at any scope (a global gitleaks / secret-scanner directory
 *     would stop running if a local value overrode it);
 *   - .git/hooks holds real hooks (git-lfs, a hand-written one) that a hooksPath would bypass.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const HOOKS = '.githooks';
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim() ?? '';
const skip = (why) => {
  if (why) console.warn(`hooks: ${why}; the design gate is ${HOOKS}/pre-commit (\`npm run precommit\` runs it by hand).`);
  process.exit(0);
};

if (process.env.CI) skip();
if (git('rev-parse', '--is-inside-work-tree') !== 'true') skip();

const current = git('config', '--get', 'core.hooksPath');
if (current === HOOKS) process.exit(0);
if (git('config', '--get', 'hooks.designGate') === 'false') skip();
if (current) skip(`core.hooksPath is already "${current}", left as is`);

const hooksDir = git('rev-parse', '--git-path', 'hooks');
let own = [];
try {
  own = readdirSync(hooksDir).filter((f) => !f.endsWith('.sample'));
} catch {}
if (own.length) skip(`${hooksDir} already has ${own.join(', ')}, left as is (a hooksPath would bypass them)`);

const r = spawnSync('git', ['config', '--local', 'core.hooksPath', HOOKS], { encoding: 'utf8' });
if (r.status !== 0) skip(`could not set core.hooksPath (${r.stderr.trim()}); run \`git config core.hooksPath ${HOOKS}\``);
console.log(`hooks: git now runs ${HOOKS}/pre-commit (design.md lint + impeccable detect) on every commit.`);
console.log(`hooks: opt this clone out with \`git config hooks.designGate false && git config --unset core.hooksPath\`.`);
