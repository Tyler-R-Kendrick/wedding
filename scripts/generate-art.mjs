#!/usr/bin/env node
// Procedural placeholder art for the wedding site. License-free by construction:
// every asset is generated from code in scripts/art/<theme>.mjs.
//   node scripts/generate-art.mjs            # all themes
//   node scripts/generate-art.mjs conservatory
// Each theme module exports `generate()` → Array<{ file: string, svg: string, alt: string }>.
// Output: public/assets/art/<theme>/<file>.svg + public/assets/art/<theme>/manifest.json
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const artDir = join(here, 'art');
const outRoot = join(here, '..', 'public', 'assets', 'art');
const only = process.argv[2];

const modules = (await readdir(artDir)).filter((f) => f.endsWith('.mjs') && (!only || f === `${only}.mjs`));
if (modules.length === 0) { console.error(`No art modules found${only ? ` for "${only}"` : ''} in scripts/art/`); process.exit(1); }

for (const file of modules) {
  const theme = file.replace(/\.mjs$/, '');
  const mod = await import(pathToFileURL(join(artDir, file)).href);
  const assets = await mod.generate();
  const dir = join(outRoot, theme);
  await mkdir(dir, { recursive: true });
  const manifest = [];
  for (const a of assets) {
    if (!/^[a-z0-9-]+\.svg$/.test(a.file)) throw new Error(`${theme}: bad asset name ${a.file}`);
    if (!a.svg.trimStart().startsWith('<svg')) throw new Error(`${theme}: ${a.file} is not an <svg> document`);
    await writeFile(join(dir, a.file), a.svg.trim() + '\n');
    manifest.push({ file: a.file, alt: a.alt ?? '', width: a.width ?? null, height: a.height ?? null });
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ theme, license: 'Generated in-repo (scripts/art); no third-party rights', assets: manifest }, null, 2) + '\n');
  console.log(`${theme}: ${assets.length} assets → public/assets/art/${theme}/`);
}
