#!/usr/bin/env node
/**
 * The pre-commit design gate: Google's `design.md` linter and impeccable's anti-slop detector,
 * run over what is being committed rather than over the whole repo.
 *
 *   node scripts/precommit.mjs     # what .githooks/pre-commit runs (npm run precommit does too)
 *
 * CI (`design-quality.yml`) runs the same tools over everything, and stays the backstop. This
 * exists so a DESIGN.md with a broken token reference, or a component that reintroduces a banned
 * face or a glow, is stopped at the author's desk instead of a push later. Each check fires only
 * when something it reads is staged, so a commit that touches no UI costs nothing.
 *
 *   1. design.md lint     every staged DESIGN.md (root + src/themes/*), read from the INDEX, so a
 *                         half-staged edit is judged as it will be committed. Errors block, and so
 *                         do `contrast-ratio` warnings: CLAUDE.md holds the site to WCAG 2.2 AA and
 *                         every DESIGN.md is at 0 warnings, so the hook keeps it there (CI only
 *                         requires 0 errors). Other warnings are printed.
 *   2. design:sync        DESIGN.md / design.json / generated theme CSS staged -> the generated
 *                         files must match their DESIGN.md (`design-sync.mjs --check`).
 *   3. impeccable detect  staged UI files; all of src/ when DESIGN.md or .impeccable/config.json
 *                         is staged, since a token change can put untouched components in drift.
 *                         Uses .impeccable/config.json ignores and waivers, exactly like CI.
 *   4. stylelint          staged CSS (the banned-font and named-colour rules live here).
 *
 * Checks 2-4 read the working tree. A file staged with further unstaged edits is named in the
 * output so nobody mistakes a pass on the working copy for a pass on the commit.
 *
 * Skip once with `git commit --no-verify`; CI will still run everything.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = (name) => path.join(ROOT, 'node_modules', '.bin', name);

const DESIGN_MD = /^(DESIGN\.md|src\/themes\/[^/]+\/DESIGN\.md)$/;
const DESIGN_SYNC_INPUTS =
  /^(DESIGN\.md|scripts\/design-sync\.mjs|src\/themes\/[^/]+\/(DESIGN\.md|design\.json|theme\.css|tailwind\.theme\.css|tokens\.generated\.json))$/;
const DETECTOR_CONTEXT = /^(DESIGN\.md|\.impeccable\/config\.json|src\/themes\/[^/]+\/(DESIGN\.md|design\.json))$/;
/** impeccable's hook extension list (reference/hooks.md), plus .mdx pages. */
const UI_FILE = /\.(tsx|jsx|ts|js|mjs|html|vue|svelte|astro|css|scss|sass|less|mdx)$/;
const CSS_FILE = /^src\/.*\.(css|scss)$/;

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}
const list = (out) => out.split('\0').filter(Boolean);

const staged = list(git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'));
const unstaged = new Set(list(git('diff', '--name-only', '-z')));

const failures = [];
const notes = [];
const say = (line = '') => process.stdout.write(`${line}\n`);

function requireBin(name) {
  if (existsSync(BIN(name))) return true;
  failures.push(`${name} is not installed — run \`npm ci\` first.`);
  return false;
}
function partial(files) {
  const both = files.filter((f) => unstaged.has(f));
  if (both.length) notes.push(`checked the working copy of ${both.join(', ')} (it has unstaged edits too)`);
}

// 1. design.md lint, on the staged blob --------------------------------------------------------
const designFiles = staged.filter((f) => DESIGN_MD.test(f));
if (designFiles.length && requireBin('design.md')) {
  // The staged blob goes through a temp file: `design.md lint -` and /dev/stdin both fail under
  // spawnSync (and Windows has no /dev/stdin).
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'precommit-design-'));
  for (const [i, file] of designFiles.entries()) {
    const copy = path.join(tmp, `${i}-DESIGN.md`);
    writeFileSync(copy, git('show', `:${file}`));
    const r = spawnSync(BIN('design.md'), ['lint', copy], { cwd: ROOT, encoding: 'utf8' });
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      failures.push(`design.md lint ${file}: could not run (${(r.stderr || r.stdout).trim().split('\n').at(-1)})`);
      continue;
    }
    const { errors, warnings } = report.summary;
    say(`design.md lint  ${file}: ${errors} error(s), ${warnings} warning(s)`);
    for (const f of report.findings.filter((x) => x.severity !== 'info')) {
      say(`  ${f.severity.padEnd(7)} ${f.rule}${f.path ? ` @ ${f.path}` : ''}: ${f.message}`);
    }
    if (errors > 0 || r.status !== 0) failures.push(`design.md lint: ${file} has ${errors} error(s)`);
    const contrast = report.findings.filter((x) => x.rule === 'contrast-ratio' && x.severity !== 'info').length;
    if (contrast) failures.push(`design.md lint: ${file} has ${contrast} pairing(s) below WCAG AA contrast`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

// 2. Generated theme CSS matches DESIGN.md --------------------------------------------------------
if (staged.some((f) => DESIGN_SYNC_INPUTS.test(f))) {
  const r = spawnSync(process.execPath, ['scripts/design-sync.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  const stale = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l && !/up to date$/.test(l));
  say(`design:sync     generated theme files ${r.status === 0 ? 'match DESIGN.md' : 'are STALE'}`);
  for (const l of stale) say(`  ${l}`);
  if (r.status !== 0) failures.push('design:sync: run `npm run design:sync` and stage the regenerated files');
}

// 3. impeccable detect --------------------------------------------------------------------------
const contextChanged = staged.some((f) => DETECTOR_CONTEXT.test(f));
const uiFiles = staged.filter((f) => UI_FILE.test(f) && existsSync(path.join(ROOT, f)));
const detectTargets = contextChanged ? ['src/'] : uiFiles;
if (detectTargets.length && requireBin('impeccable')) {
  partial(contextChanged ? staged.filter((f) => f.startsWith('src/')) : uiFiles);
  const label = contextChanged ? 'src/ (design context changed)' : `${uiFiles.length} staged file(s)`;
  const r = spawnSync(BIN('impeccable'), ['detect', '--no-advisory', ...detectTargets], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // impeccable prints findings to stderr and keeps stdout for --json.
  const out = `${r.stdout}${r.stderr}`.trim();
  if (r.status === 0) {
    say(`impeccable      ${label}: clean`);
  } else {
    say(`impeccable      ${label}:`);
    say(out.replace(/^/gm, '  '));
    failures.push(
      r.status === 2
        ? 'impeccable detect: fix the findings above, or record a waiver with `.claude/skills/impeccable/scripts/impeccable hooks ignore-value …`'
        : `impeccable detect could not scan a target (exit ${r.status})`,
    );
  }
}

// 4. stylelint ----------------------------------------------------------------------------------
const cssFiles = staged.filter((f) => CSS_FILE.test(f) && existsSync(path.join(ROOT, f)));
if (cssFiles.length && requireBin('stylelint')) {
  partial(cssFiles);
  const r = spawnSync(BIN('stylelint'), ['--allow-empty-input', ...cssFiles], { cwd: ROOT, encoding: 'utf8' });
  say(`stylelint       ${cssFiles.length} staged file(s): ${r.status === 0 ? 'clean' : 'findings'}`);
  if (r.status !== 0) {
    say(`${r.stdout}${r.stderr}`.trim().replace(/^/gm, '  '));
    failures.push('stylelint: fix the findings above');
  }
}

for (const n of notes) say(`note: ${n}`);
if (failures.length) {
  say('\npre-commit design gate FAILED:');
  for (const f of failures) say(`  - ${f}`);
  say('\nBypass once with `git commit --no-verify` (CI still runs every check).');
  process.exit(1);
}
