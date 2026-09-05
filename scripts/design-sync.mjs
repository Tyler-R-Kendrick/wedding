#!/usr/bin/env node
/**
 * design:sync — regenerate the per-theme token CSS from each theme's DESIGN.md.
 *
 *   node scripts/design-sync.mjs           # write src/themes/<id>/theme.css (+ tailwind.theme.css for the default theme)
 *   node scripts/design-sync.mjs --check   # exit 1 when a generated file is stale (CI drift gate)
 *
 * Sources of truth, in order:
 *   1. `npx design.md export --format css-vars` (colors, spacing, rounded)   -> re-scoped under [data-theme="<id>"]
 *   2. DESIGN.md front matter `typography`                                    -> --font-<role>, --type-<style>-*
 *   3. src/themes/<id>/design.json `extensions` (motion, shadows, focus, ornaments) -> --duration-*, --ease-*, --shadow-*, --art-*
 *   4. `npx design.md export --format css-tailwind` for the default theme      -> Tailwind v4 @theme block (globals.css imports it)
 *
 * Fonts (@font-face) are hand-written in src/themes/<id>/fonts.css and are not generated.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = ['gilded-hour', 'conservatory'];
const DEFAULT_THEME = 'gilded-hour';
const CHECK = process.argv.includes('--check');

/** Family -> full stack. The "<Family> Fallback" faces are metric-matched local() fonts declared in fonts.css. */
const FAMILY_STACKS = {
  Cinzel: '"Cinzel", "Cinzel Fallback", "Times New Roman", serif',
  'Josefin Sans': '"Josefin Sans", "Josefin Sans Fallback", system-ui, sans-serif',
  'Big Shoulders Display': '"Big Shoulders Display", "Big Shoulders Display Fallback", system-ui, sans-serif',
  Gloock: '"Gloock", "Gloock Fallback", "Times New Roman", serif',
  Spectral: '"Spectral", "Spectral Fallback", "Times New Roman", serif',
  Cardo: '"Cardo", "Cardo Fallback", "Times New Roman", serif',
};

const bin = path.join(ROOT, 'node_modules', '.bin', 'design.md');
function designMd(args) {
  return execFileSync(bin, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
}

/* ---------- minimal YAML front-matter parser (the subset DESIGN.md uses: nested maps + scalars + folded blocks) ---------- */
function scalar(v) {
  v = v.trim();
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
  if (/^'.*'$/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error('DESIGN.md has no YAML front matter');
  const lines = m[1].split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    const mm = line.match(/^([^:]+):\s*(.*)$/);
    if (!mm) throw new Error(`design-sync: cannot parse front matter line: ${raw}`);
    const key = mm[1].trim();
    const value = mm[2];
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (value === '') {
      const obj = {};
      parent[key] = obj;
      stack.push({ indent, obj });
      continue;
    }
    if (/^[>|][-+]?$/.test(value)) {
      const buf = [];
      while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].match(/^ */)[0].length > indent)) {
        buf.push(lines[i + 1].trim());
        i++;
      }
      parent[key] = buf.join(' ').trim();
      continue;
    }
    parent[key] = scalar(value);
  }
  return root;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function typographyVars(fm) {
  const typo = fm.typography ?? {};
  const out = [];
  const families = [];
  for (const [name, style] of Object.entries(typo)) {
    if (style.fontFamily && !families.includes(style.fontFamily)) families.push(style.fontFamily);
  }
  const stackFor = (family) => {
    const stack = FAMILY_STACKS[family];
    if (!stack) throw new Error(`design-sync: no fallback stack configured for font family "${family}" (add it to FAMILY_STACKS)`);
    return stack;
  };
  const display = typo['display-xl']?.fontFamily ?? families[0];
  const text = typo['body-md']?.fontFamily ?? families[1] ?? display;
  const accent = families.find((f) => f !== display && f !== text) ?? text;
  out.push(`  /* font roles: display (headings), text (running copy), accent (numerals or specimen labels) */`);
  out.push(`  --font-display: ${stackFor(display)};`);
  out.push(`  --font-text: ${stackFor(text)};`);
  out.push(`  --font-accent: ${stackFor(accent)};`);
  for (const f of families) out.push(`  --font-${slug(f)}: ${stackFor(f)};`);
  out.push(`  /* type styles: --type-<style>-{family,size,weight,line,tracking,features} */`);
  for (const [name, s] of Object.entries(typo)) {
    const n = slug(name);
    out.push(`  --type-${n}-family: ${stackFor(s.fontFamily)};`);
    out.push(`  --type-${n}-size: ${s.fontSize};`);
    out.push(`  --type-${n}-weight: ${s.fontWeight};`);
    out.push(`  --type-${n}-line: ${s.lineHeight ?? 1.2};`);
    out.push(`  --type-${n}-tracking: ${s.letterSpacing ?? '0em'};`);
    out.push(`  --type-${n}-features: ${s.fontFeature ?? 'normal'};`);
  }
  return out;
}

function extensionVars(themeId, sidecar) {
  const ext = sidecar.extensions ?? {};
  const out = [];
  out.push(`  /* motion (design.json extensions.motion) */`);
  for (const m of ext.motion ?? []) {
    if (!/^(duration|ease|stagger)-/.test(m.name)) continue;
    out.push(`  --${slug(m.name)}: ${m.value};`);
  }
  out.push(`  /* shadows (design.json extensions.shadows) */`);
  for (const s of ext.shadows ?? []) out.push(`  --shadow-${slug(s.name)}: ${s.value};`);
  if (ext.focus?.ring) {
    out.push(`  /* focus (design.json extensions.focus) */`);
    out.push(`  --focus-ring: ${ext.focus.ring};`);
    out.push(`  --focus-offset: ${ext.focus.offset ?? '2px'};`);
  }
  out.push(`  /* procedural art (design.json extensions.ornaments; files in public/assets/art/${themeId}) */`);
  for (const o of ext.ornaments ?? []) {
    if (!o.file || /[{…]/.test(o.file)) continue;
    const url = o.file.replace(/^public/, '');
    out.push(`  --art-${slug(o.name)}: url("${url}");`);
  }
  return out;
}

function generateTheme(themeId) {
  const dir = path.join(ROOT, 'src', 'themes', themeId);
  const designPath = path.join(dir, 'DESIGN.md');
  const sidecarPath = path.join(dir, 'design.json');
  const md = readFileSync(designPath, 'utf8');
  const fm = parseFrontmatter(md);
  const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf8')) : {};
  const cssVars = designMd(['export', '--format', 'css-vars', designPath]);
  const body = cssVars.match(/:root\s*\{([\s\S]*?)\}/);
  if (!body) throw new Error(`design-sync: unexpected css-vars output for ${themeId}`);
  const lines = [
    `/* GENERATED by scripts/design-sync.mjs from src/themes/${themeId}/DESIGN.md (+ design.json). DO NOT EDIT. */`,
    `/* Regenerate: npm run design:sync. CI fails on drift: npm run design:sync:check. */`,
    `[data-theme="${themeId}"] {`,
    `  /* colors, spacing, rounded (design.md export --format css-vars) */`,
    ...body[1].split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()),
    ...typographyVars(fm),
    ...extensionVars(themeId, sidecar),
    `}`,
    ``,
  ];
  return lines.join('\n');
}

function generateTailwindTheme(themeId) {
  const designPath = path.join(ROOT, 'src', 'themes', themeId, 'DESIGN.md');
  const css = designMd(['export', '--format', 'css-tailwind', designPath]);
  return [
    `/* GENERATED by scripts/design-sync.mjs from src/themes/${themeId}/DESIGN.md (design.md export --format css-tailwind). DO NOT EDIT. */`,
    `/* Tailwind v4 @theme: the default theme's values. Utilities reference these variables; other themes override them under [data-theme]. */`,
    css.trim(),
    ``,
  ].join('\n');
}

const outputs = [];
for (const id of THEMES) outputs.push({ file: path.join(ROOT, 'src', 'themes', id, 'theme.css'), content: generateTheme(id) });
outputs.push({ file: path.join(ROOT, 'src', 'themes', DEFAULT_THEME, 'tailwind.theme.css'), content: generateTailwindTheme(DEFAULT_THEME) });

let stale = 0;
for (const { file, content } of outputs) {
  const rel = path.relative(ROOT, file);
  const current = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (CHECK) {
    if (current !== content) {
      stale++;
      console.error(`design-sync: ${rel} is stale (run npm run design:sync)`);
    } else {
      console.log(`design-sync: ${rel} up to date`);
    }
  } else {
    writeFileSync(file, content);
    console.log(`design-sync: wrote ${rel}`);
  }
}
if (CHECK && stale) process.exit(1);
