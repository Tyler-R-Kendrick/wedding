#!/usr/bin/env node
/**
 * No SHARED component may read a token only one design declares.
 *
 * `globals.css` imports the DEFAULT design's Tailwind `@theme` block unscoped, and
 * `components/tokens/foundation.css` declares the same family of names at `:root` for the admin and
 * auth surfaces. So `--text-h3`, `--font-weight-h3`, `--text-body-md`, `--tracking-label-caps` and
 * their siblings ALWAYS RESOLVE — to one design's numbers, under both designs.
 *
 * Nothing else catches it. stylelint sees a `var()`. `scripts/check-css-vars.mjs` sees a definition
 * and is satisfied. axe sees a size. The only tell in a browser is that the two designs compute the
 * same value for a control each design sizes differently, and even that is invisible wherever the
 * two scales happen to agree. An independent review found two of these by measuring two elements —
 * `.card__title` at Gloock 19.13px/600 in Conservatory (a 1.06px step over its own `.card__meta`,
 * with an inert 600 on a single-weight face) and `.inp`/`.fld__hint` sized so a field's hint
 * outranked its label. There were fifteen.
 *
 * The per-`[data-theme]` set is `--type-<style>-<prop>` (generated from each theme's DESIGN.md by
 * `npm run design:sync`) plus the role tokens in `themes/shared/base.css`. That is what a shared
 * component reads. A theme's OWN stylesheet may read anything: it is already scoped.
 *
 * Runs in `npm run test:unit` (tests/unit/theme-tokens.test.ts) so it cannot be a gate that exists
 * only in a workflow file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Files that are rendered under `[data-theme]` and are shared by both designs. A theme's own
 * `kit.css` is excluded because it is already scoped to one design; the admin console and the dev
 * inbox are excluded because they deliberately never carry `[data-theme]` and the foundation set is
 * the right one for them.
 */
const SHARED = [
  'src/components/rsvp',
  'src/components/media',
  'src/components/mediaai',
  'src/components/concierge',
  'src/components/provenance',
  'src/components/floorplan',
  'src/themes/shared',
];

/** The unscoped families. `--type-*` and `--color-*` are per-theme and always fine. */
const UNSCOPED = /var\(\s*(--text-[a-z0-9-]+|--font-weight-[a-z0-9-]+|--tracking-[a-z0-9-]+|--font-(?:display|body|h1|h2|h3|label|numeral|control)-[a-z0-9-]+)/g;

/**
 * A read that is a documented FALLBACK behind a `--type-*` first choice is fine and is the pattern
 * `auth.css` uses: `var(--type-body-sm-size, var(--text-body-sm, 1rem))` resolves per design when
 * one is present and to the foundation when none is. Only a FIRST-position read is a leak.
 */
const GUARDED = /var\(\s*--type-[a-z0-9-]+\s*,\s*var\(\s*(--text-|--font-weight-|--tracking-|--font-)/;

function cssFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (full.endsWith('.css')) out.push(full);
  }
  return out;
}

export function findLeaks(root = cwd()) {
  const leaks = [];
  for (const dir of SHARED) {
    let files;
    try {
      files = cssFiles(join(root, dir));
    } catch {
      continue; // a directory a future level removes is not a failure
    }
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (GUARDED.test(line)) return;
        for (const match of line.matchAll(UNSCOPED)) {
          leaks.push({ file: relative(root, file), line: i + 1, token: match[1], text: line.trim() });
        }
      });
    }
  }
  return leaks;
}

function check() {
  const leaks = findLeaks();
  if (leaks.length) {
    console.error(`Shared components reading a token only one design declares (${leaks.length}):`);
    for (const l of leaks) console.error(`  ${l.file}:${l.line}  ${l.token}\n      ${l.text}`);
    console.error('\n  -> use the per-[data-theme] `--type-<style>-<prop>` set, or put the unscoped name in the\n     SECOND position as a fallback: var(--type-body-sm-size, var(--text-body-sm, 1rem)).');
    exit(1);
  }
  console.log('theme tokens ok: no shared component reads an unscoped --text-*/--font-weight-*/--tracking-* token');
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) check();
