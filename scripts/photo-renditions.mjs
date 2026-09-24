#!/usr/bin/env node
// Smaller copies of the couple's adventure photos, for the postcards beside the atlas.
//
//   node scripts/photo-renditions.mjs    # write public/assets/photos/adventures/800/ and the size table
//
// The renditions in public/assets/photos/adventures/ are 1600px on the long side; a postcard is at
// most 22rem wide, so on most screens the browser needs a quarter of those pixels. This writes an
// 800px-wide copy of each (WebP, no metadata) and src/content/photo-sizes.json, which gives every
// original's real width so `srcset` describes the files truthfully. Then run `npm run photos:stamp`:
// the copies carry the same rights statement as the originals (docs/ops/asset-licensing.md 4a).
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(root, 'public', 'assets', 'photos', 'adventures');
export const SMALL = 800;
const out = join(DIR, String(SMALL));
await mkdir(out, { recursive: true });

const sizes = {};
for (const file of (await readdir(DIR)).filter((f) => f.endsWith('.webp')).sort()) {
  const { width, height } = await sharp(join(DIR, file)).metadata();
  sizes[file] = [width, height];
  if (width <= SMALL) continue;
  await sharp(join(DIR, file)).resize({ width: SMALL }).webp({ quality: 78, effort: 6 }).toFile(join(out, file));
}
await writeFile(join(root, 'src', 'content', 'photo-sizes.json'), `${JSON.stringify(sizes, null, 1)}\n`);
console.log(`${Object.keys(sizes).length} photos measured; ${SMALL}px copies in public/assets/photos/adventures/${SMALL}/`);
