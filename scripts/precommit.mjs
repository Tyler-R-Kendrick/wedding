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
 *   2. design:sync        a theme's DESIGN.md / design.json, its generated CSS, the generator or the
 *                         lockfile staged -> the generated files must match (`design-sync.mjs
 *                         --check`). That script reads the working tree, so when any of its inputs
 *                         or outputs differs from the index the check cannot vouch for the commit
 *                         and blocks instead: "regenerated but forgot to stage theme.css" is the
 *                         mistake this check exists for.
 *   3. impeccable detect  staged UI files, plus all of src/ when DESIGN.md or .impeccable/config.json
 *                         is staged, since a token change can put untouched components in drift.
 *                         Anti-patterns block, and so does any size, colour or radius off the
 *                         DESIGN.md scale (`check-design-drift.mjs`: the detector only advises on
 *                         those). Uses .impeccable/config.json ignores and waivers, exactly like CI.
 *   4. stylelint          staged CSS (the banned-font and named-colour rules live here).
 *
 * Checks 3 and 4 read the working tree (and 3 reads the working-copy DESIGN.md as its context).
 * Any file they read that differs from the index, untracked files under src/ included, is named in
 * the output so nobody mistakes a result on the working copy for a result on the commit.
 *
 * A finding is fixed, or waived with `impeccable hooks ignore-value … --reason`; CLAUDE.md rules out
 * `--no-verify` for UI work.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, detect, format } from './check-design-drift.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DESIGN_MD = /^(DESIGN\.md|src\/themes\/[^/]+\/DESIGN\.md)$/;
/** Everything `design-sync.mjs` reads or writes, plus what decides its output. */
const DESIGN_SYNC_FILES =
  /^(package-lock\.json|scripts\/design-sync\.mjs|src\/themes\/[^/]+\/(DESIGN\.md|design\.json|theme\.css|tailwind\.theme\.css|tokens\.generated\.json))$/;
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

/**
 * A package's CLI, run as `node <its bin script>`. node_modules/.bin holds sh shims on POSIX and
 * .cmd shims on Windows, and spawnSync can launch neither portably; the script itself runs anywhere.
 */
function tool(pkg, binName) {
  const manifest = path.join(ROOT, 'node_modules', pkg, 'package.json');
  if (!existsSync(manifest)) return null;
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
  const rel = typeof bin === 'string' ? bin : bin?.[binName];
  return rel ? path.join(path.dirname(manifest), rel) : null;
}
function run(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '', out: r.error ? String(r.error) : out };
}

const staged = list(git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'));
const unstaged = new Set(list(git('diff', '--name-only', '-z')));

const failures = [];
const notes = [];
const say = (line = '') => process.stdout.write(`${line}\n`);

function locate(pkg, binName) {
  const script = tool(pkg, binName);
  if (!script) failures.push(`${binName} is not installed — run \`npm ci\` first.`);
  return script;
}
function partial(files, what) {
  const both = files.filter((f) => unstaged.has(f));
  if (both.length) notes.push(`${what} read the working copy of ${both.join(', ')}, which differs from what is staged`);
}

// 1. design.md lint, on the staged blob --------------------------------------------------------
const designFiles = staged.filter((f) => DESIGN_MD.test(f));
const designMd = designFiles.length && locate('@google/design.md', 'design.md');
if (designMd) {
  // The staged blob goes through a temp file: `design.md lint -` and /dev/stdin both fail under
  // spawnSync (and Windows has no /dev/stdin).
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'precommit-design-'));
  try {
    for (const [i, file] of designFiles.entries()) {
      const copy = path.join(tmp, `${i}-DESIGN.md`);
      writeFileSync(copy, git('show', `:${file}`));
      const r = run(designMd, ['lint', copy]);
      let report = null;
      try {
        report = JSON.parse(r.stdout);
      } catch {}
      if (!report?.summary) {
        failures.push(`design.md lint ${file}: could not run (${r.out.split('\n').at(-1) || `exit ${r.status}`})`);
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 2. Generated theme CSS matches DESIGN.md --------------------------------------------------------
if (staged.some((f) => DESIGN_SYNC_FILES.test(f))) {
  const drifted = [...unstaged].filter((f) => DESIGN_SYNC_FILES.test(f));
  if (drifted.length) {
    say(`design:sync     cannot vouch for the commit: ${drifted.join(', ')} differ(s) from what is staged`);
    failures.push('design:sync: run `npm run design:sync`, then stage the theme files it writes along with their DESIGN.md');
  } else {
    const r = run(path.join(ROOT, 'scripts', 'design-sync.mjs'), ['--check']);
    say(`design:sync     generated theme files ${r.status === 0 ? 'match DESIGN.md' : 'are STALE'}`);
    for (const l of r.out.split('\n').filter((l) => l && !/up to date$/.test(l))) say(`  ${l}`);
    if (r.status !== 0) failures.push('design:sync: run `npm run design:sync` and stage the regenerated files');
  }
}

// 3. impeccable detect --------------------------------------------------------------------------
const contextChanged = staged.some((f) => DETECTOR_CONTEXT.test(f));
const uiFiles = staged.filter((f) => UI_FILE.test(f) && existsSync(path.join(ROOT, f)));
const detectTargets = contextChanged ? ['src/', ...uiFiles.filter((f) => !f.startsWith('src/'))] : uiFiles;
if (detectTargets.length) {
  if (contextChanged) {
    partial(staged.filter((f) => DETECTOR_CONTEXT.test(f)), 'impeccable (design context)');
    const wip = [
      ...[...unstaged].filter((f) => f.startsWith('src/')),
      ...list(git('ls-files', '--others', '--exclude-standard', '-z', '--', 'src')),
    ];
    if (wip.length) notes.push(`impeccable scanned all of src/, including uncommitted work in ${wip.join(', ')}`);
  } else {
    partial(uiFiles, 'impeccable');
  }
  const label = contextChanged ? 'src/ + staged UI files (design context changed)' : `${uiFiles.length} staged file(s)`;
  const result = detect(detectTargets);
  if (result.error) {
    failures.push(`impeccable detect: ${result.error}`);
  } else {
    const { primary, drift, notes: copy } = classify(result.findings);
    say(`impeccable      ${label}: ${primary.length} anti-pattern(s), ${drift.length} off the DESIGN.md scale`);
    for (const f of [...primary, ...drift]) say(`  ${format(f)}`);
    for (const f of copy) say(`  note ${format(f)}`);
    if (primary.length) failures.push('impeccable detect: fix the anti-patterns above, or waive a false positive with `impeccable hooks ignore-value … --reason "…"`');
    if (drift.length) failures.push('impeccable detect: use a DESIGN.md token for each value above, or add the step to DESIGN.md and run `npm run design:sync`');
  }
}

// 4. stylelint ----------------------------------------------------------------------------------
const cssFiles = staged.filter((f) => CSS_FILE.test(f) && existsSync(path.join(ROOT, f)));
const stylelint = cssFiles.length && locate('stylelint', 'stylelint');
if (stylelint) {
  partial(cssFiles, 'stylelint');
  const r = run(stylelint, ['--allow-empty-input', ...cssFiles]);
  say(`stylelint       ${cssFiles.length} staged file(s): ${r.status === 0 ? 'clean' : 'findings'}`);
  if (r.status !== 0) {
    say(r.out.replace(/^/gm, '  '));
    failures.push('stylelint: fix the findings above');
  }
}

for (const n of notes) say(`note: ${n}`);
if (failures.length) {
  say('\npre-commit design gate FAILED:');
  for (const f of failures) say(`  - ${f}`);
  say('\nFix the finding, or waive a false positive with a reason. `--no-verify` is not a way to land');
  say('UI work (CLAUDE.md); CI runs every one of these checks on the pull request regardless.');
  process.exit(1);
}
