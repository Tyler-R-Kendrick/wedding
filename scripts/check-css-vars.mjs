#!/usr/bin/env node
/**
 * Every `var(--token)` a component references must be DEFINED somewhere in `src/`, or carry an
 * explicit fallback.
 *
 * This exists because of a defect level 14 found by looking at a screenshot. `ops.css` set
 * `font-family: var(--font-sans)` and `var(--font-display)`; neither token is defined anywhere in
 * `src/`. An undefined custom property makes the declaration invalid at computed-value time, so the
 * property falls back to whatever else applies — here Tailwind's default stack — and the entire
 * admin console rendered in Roboto, Helvetica Neue and Arial, three faces CLAUDE.md bans by name.
 *
 * `npm run lint:css`, `npm run design:lint`, `npm run slop:detect` and axe were ALL green
 * throughout. stylelint's font rules match literal `font-family` values and cannot see through an
 * indirection that resolves to one; the design linter reads DESIGN.md, not components; the detector
 * looks for slop patterns; axe does not judge typefaces. Nothing in the toolchain compares a
 * reference to a definition, which is what this does.
 *
 * The check is deliberately about the whole class, not about fonts: a missing `--color-*` silently
 * inherits, a missing `--spacing-*` silently collapses. Both are the same bug with a quieter
 * symptom.
 *
 * WHAT COUNTS AS DEFINED
 *   - `--name:` in any `src/**\/*.css` (including inside `@theme`, `:root`, a class, a media query);
 *   - `'--name':` or `"--name":` in a `.ts`/`.tsx` inline style object;
 *   - `setProperty('--name', …)`.
 * Definitions are collected globally, not per selector: proving that a token reaches a given
 * element at runtime is a cascade question a static check cannot answer, and the failure this
 * catches is a token that exists NOWHERE.
 *
 * WHAT IS ALLOWED WITHOUT A DEFINITION
 *   - `var(--name, fallback)`. A fallback is the author saying what happens when the token is
 *     absent, so the rendered result is theirs rather than a framework default. That is precisely
 *     what `ops.css` and `auth.css` were missing.
 *
 * Run: `node scripts/check-css-vars.mjs` (exit 1 on findings). Wired into `npm run quality`.
 */
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { argv, exit } from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');
const SKIP_DIRS = new Set(['node_modules', '.next', '.data', 'migrations']);

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (/\.(css|scss|ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `--name:` in CSS, `'--name':` / `"--name":` in TS objects, and `setProperty('--name'`. */
const DEFINITION_PATTERNS = [
  /(^|[;{}\s])(--[a-zA-Z0-9_-]+)\s*:/g,
  /['"](--[a-zA-Z0-9_-]+)['"]\s*:/g,
  /setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)['"`]/g,
];

/** `var(--name` — group 1 is the token, group 2 tells us whether a fallback follows. */
const REFERENCE = /var\(\s*(--[a-zA-Z0-9_-]+)\s*(,?)/g;

/**
 * Block comments are stripped before anything is matched, and only from the REFERENCE pass.
 * Both files that carry the level-14 post-mortem quote the broken code in a comment
 * (`\`var(--font-sans)\` … defined nowhere`), and a checker that reports the description of a bug
 * as the bug is a checker people turn off. Line comments are left alone: `//` also appears inside
 * URLs, and no reference has yet hidden behind one. Definitions are matched on the ORIGINAL text,
 * so a token that is only ever mentioned in a comment still does not count as defined.
 */
const stripBlockComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

export async function check() {
  const files = await walk(SRC);
  const defined = new Set();
  const references = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of DEFINITION_PATTERNS) {
      pattern.lastIndex = 0;
      for (const m of text.matchAll(pattern)) defined.add(m[m.length - 1]);
    }
    const code = stripBlockComments(text);
    REFERENCE.lastIndex = 0;
    for (const m of code.matchAll(REFERENCE)) {
      if (m[2] === ',') continue; // has a fallback: the author chose the outcome
      const line = code.slice(0, m.index).split('\n').length;
      references.push({ token: m[1], file: relative(ROOT, file), line });
    }
  }

  const missing = references.filter((r) => !defined.has(r.token));
  return { defined: defined.size, referenced: references.length, missing };
}

// Importable: tests/unit/css-vars.test.ts calls `check()` so the gate also runs inside
// `npm run test:unit`, which `npm run verify` and the CI verify job both call. Running the CLI on
// import would exit the test process, hence the entry-point guard.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await check();
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`css vars: ${result.defined} defined, ${result.referenced} references without a fallback`);
    for (const m of result.missing) {
      console.error(`  ${m.file}:${m.line}  var(${m.token}) is defined nowhere in src/ and has no fallback`);
    }
  }
  if (result.missing.length > 0) {
    console.error(`\n${result.missing.length} undefined custom propert${result.missing.length === 1 ? 'y' : 'ies'}.`);
    console.error('Define the token, use one that exists, or give the reference an explicit fallback.');
    exit(1);
  }
}
