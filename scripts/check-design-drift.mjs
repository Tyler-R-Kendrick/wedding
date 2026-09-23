#!/usr/bin/env node
/**
 * impeccable detect, with design-system drift treated as a failure.
 *
 *   node scripts/check-design-drift.mjs [paths…]     # default: the whole repo, like `slop:detect`
 *
 * `impeccable detect` exits 2 on its primary (anti-slop) findings but only *advises* when a literal
 * font-size, colour or radius is off the DESIGN.md scale (`design-system-font-size`,
 * `design-system-color`, `design-system-radius`), and advisories never change its exit code. That
 * is how fifteen off-ramp sizes accumulated while `npm run quality` stayed green, one of them the
 * 15px placeholder nav under PRODUCT.md's 17px floor. Every DESIGN.md token is now matched, so this
 * holds the count at zero: a new step goes into DESIGN.md (and `npm run design:sync`), or the value
 * uses a `--type-*` / `--color-*` / `--rounded-*` token, or it gets a reasoned
 * `impeccable hooks ignore-value`.
 *
 * Other advisories (em-dash density and the like) are copy notes and are printed, not failed.
 * Runs in `npm run quality`, in CI, and on staged files from `scripts/precommit.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `drift` is an advisory that means the code left the documented design system. */
export function classify(findings) {
  const primary = [];
  const drift = [];
  const notes = [];
  for (const f of findings) {
    if (!f.advisory) primary.push(f);
    else if (String(f.antipattern).startsWith('design-system-')) drift.push(f);
    else notes.push(f);
  }
  return { primary, drift, notes };
}

export function format(f) {
  const where = String(f.file).startsWith(ROOT) ? path.relative(ROOT, f.file) : f.file;
  const hint = f.advisory && f.ignoreValue ? `  (waive: impeccable hooks ignore-value ${f.antipattern} "${f.ignoreValue}" --file "${where}" --reason "…")` : '';
  return `${where}${f.line ? `:${f.line}` : ''}  [${f.antipattern}] ${f.snippet}${hint}`;
}

/** Runs the detector; `{ findings }` on success, `{ error }` when a target could not be scanned. */
export function detect(targets) {
  const manifest = path.join(ROOT, 'node_modules', 'impeccable', 'package.json');
  let bin;
  try {
    bin = path.join(path.dirname(manifest), JSON.parse(readFileSync(manifest, 'utf8')).bin.impeccable);
  } catch {
    return { error: 'impeccable is not installed — run `npm ci` first.' };
  }
  const r = spawnSync(process.execPath, [bin, 'detect', '--json', ...targets], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { error: String(r.error) };
  if (r.status === 1) return { error: (r.stderr || r.stdout).trim().split('\n').at(-1) || 'a target could not be scanned' };
  try {
    return { findings: JSON.parse(r.stdout || '[]') };
  } catch {
    return { error: `unreadable detector output (exit ${r.status})` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const targets = process.argv.slice(2);
  const result = detect(targets.length ? targets : ['.']);
  if (result.error) {
    console.error(`design drift: ${result.error}`);
    process.exit(1);
  }
  const { primary, drift, notes } = classify(result.findings);
  for (const f of primary) console.log(format(f));
  for (const f of drift) console.log(format(f));
  if (notes.length) console.log(`${notes.length} copy advisory note(s), not failed:\n${notes.map((f) => `  ${format(f)}`).join('\n')}`);
  if (primary.length || drift.length) {
    console.error(`\ndesign drift: ${primary.length} anti-pattern(s), ${drift.length} value(s) off the DESIGN.md scale.`);
    process.exit(1);
  }
  console.log('design drift: 0 anti-patterns, every size, colour and radius on the DESIGN.md scale.');
}
