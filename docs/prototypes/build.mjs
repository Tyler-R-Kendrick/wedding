/**
 * Assembles the standalone feature-lab pages in docs/prototypes/ from the
 * fragments in docs/prototypes/src/.
 *
 * Each page is one self-contained HTML file (publishable as a Claude Code
 * artifact, openable with `open docs/prototypes/<id>.html`). The wedding
 * design tokens are inlined verbatim from src/themes/<id>/theme.css so the
 * lab can never drift from the shipped theme: regenerate with
 *   npm run design:sync && node docs/prototypes/build.mjs
 *
 * Artifacts are wrapped in <!doctype html><head>…</head><body> at publish
 * time, so a page here starts at <title> and carries no <html>/<head>/<body>.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const src = join(here, 'src');

const read = (p) => readFileSync(p, 'utf8');

/**
 * The generated theme CSS, minus the procedural-art URLs: those point at
 * /assets/art/* on the real origin, which an artifact cannot fetch (the CSP
 * admits no external images). The lab draws its ornaments in CSS instead.
 */
function themeTokens(themeId) {
  return read(join(repo, 'src', 'themes', themeId, 'theme.css'))
    .replace(/^\s*--art-[a-z-]+:\s*url\([^)]*\);\s*$/gm, '')
    .replace(/^\/\*.*?\*\/\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const shell = read(join(src, '_shell.css'));
const script = read(join(src, '_shell.js'));
const tokens = [themeTokens('gilded-hour'), themeTokens('conservatory')].join('\n\n');

const pages = readdirSync(src).filter((f) => f.endsWith('.html'));
for (const file of pages) {
  const body = read(join(src, file));
  const out = body
    .replace('/*@SHELL_CSS@*/', () => shell)
    .replace('/*@THEME_TOKENS@*/', () => tokens)
    .replace('/*@SHELL_JS@*/', () => script);
  if (out.includes('/*@')) throw new Error(`${file}: unresolved include marker`);
  writeFileSync(join(here, file), out);
  console.log(`built docs/prototypes/${file} (${(out.length / 1024).toFixed(1)} kB)`);
}
