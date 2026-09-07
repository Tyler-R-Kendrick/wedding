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
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const src = join(here, 'src');

const read = (p) => readFileSync(p, 'utf8');

/**
 * Inline an SVG as a URL-encoded data: URI. A published artifact cannot fetch
 * /assets/art/*, and the two kits are largely *made of* their ornament — the
 * sunburst, the chevron rules, the fern divider — so the art travels with the
 * page rather than being dropped. URL encoding (not base64) keeps the payload
 * small and the token legible.
 */
function inlineSvg(absPath) {
  const svg = read(absPath)
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const encoded = svg
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26');
  return `url("data:image/svg+xml,${encoded}")`;
}

/**
 * The generated theme CSS with every --art-* token resolved to inline art.
 * Everything else is passed through byte-for-byte, so a lab cannot drift from
 * the shipped kit.
 */
function themeTokens(themeId) {
  let missing = 0;
  const css = read(join(repo, 'src', 'themes', themeId, 'theme.css')).replace(
    /url\("\/assets\/(art\/[^"]+\.svg)"\)/g,
    (whole, rel) => {
      const abs = join(repo, 'public', 'assets', rel);
      if (!existsSync(abs)) {
        missing += 1;
        console.warn(`  ! ${themeId}: missing ${rel}, leaving token unresolved`);
        return whole;
      }
      return inlineSvg(abs);
    },
  );
  if (missing) console.warn(`  ! ${themeId}: ${missing} art asset(s) unresolved`);
  return css
    .replace(/^\/\*.*?\*\/\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const shell = read(join(src, '_shell.css'));
const script = read(join(src, '_shell.js'));
const icons = read(join(src, '_icons.html')).trim();
const tokens = [themeTokens('gilded-hour'), themeTokens('conservatory')].join('\n\n');

const pages = readdirSync(src).filter((f) => f.endsWith('.html') && !f.startsWith('_'));
for (const file of pages) {
  const body = read(join(src, file));
  const out = body
    .replace('/*@SHELL_CSS@*/', () => shell)
    .replace('/*@THEME_TOKENS@*/', () => tokens)
    .replace('<!--@ICONS@-->', () => icons)
    .replace('/*@SHELL_JS@*/', () => script);
  if (out.includes('/*@') || out.includes('<!--@')) throw new Error(`${file}: unresolved include marker`);
  writeFileSync(join(here, file), out);
  console.log(`built docs/prototypes/${file} (${(out.length / 1024).toFixed(1)} kB)`);
}
