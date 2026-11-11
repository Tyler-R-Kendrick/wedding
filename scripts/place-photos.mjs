#!/usr/bin/env node
/**
 * Photographs of the couple's recommended places: card-sized derivatives + a manifest the site reads.
 *
 *   node scripts/place-photos.mjs           # licence-ledger files -> public/media/places/ + manifest.json
 *   node scripts/place-photos.mjs --check   # CI: every manifest file exists with its hash, every item points at the ledger
 *
 * Each place names one file already in public/assets/attributions.json (fetched through
 * scripts/fetch-openverse.mjs / fetch-commons.mjs, which refuse anything outside the licence allowlist).
 * Nothing here downloads, generates or invents an image. A recommendation with no photograph of *that*
 * place we may publish is simply absent: a generic stand-in is worse than none
 * (docs/ops/asset-licensing.md).
 *
 * Every derivative is a 4:3 crop around `focal`, re-encoded (which strips EXIF/GPS) to AVIF and WebP at
 * 640px — the Your Trip card's own width — and 1024px (capped at what the crop holds, never upscaled).
 * The card renders `src` (the 640px WebP, which every browser the site supports can decode); the other
 * files are there for a `srcset` when a slot wants one. `src/domain/media/place-photos.ts` reads the
 * manifest; `/credits` lists the ledger entries themselves.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'media', 'places');
const MANIFEST = join(OUT, 'manifest.json');
const LEDGER = join(ROOT, 'public', 'assets', 'attributions.json');
const RECOMMENDATIONS = join(ROOT, 'src', 'content', 'seed', 'recommendations.json');
const WIDTHS = [640, 1024];
const ASPECT = 4 / 3;
/** Bytes a card-width file may take (docs/ops/asset-licensing.md has no number; ~80 KB is the site's budget). */
const BUDGET = 78_000;

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/**
 * One photograph per recommendation slug. Alt text says what is in the frame, plainly.
 * Checked by eye on 2026-11-11; each Flickr licence was also re-read on its source page that day.
 */
const PLACES = [
  { slug: 'lincoln-park-zoo', ledgerId: 'openverse-3ddc7fd2-8e96-4b70-8cb7-f0d2ac243f00', focal: [0.5, 0.5],
    alt: 'A lioness and two lion cubs standing on grass in their enclosure at Lincoln Park Zoo.' },
  { slug: 'maggie-daley-park', ledgerId: 'openverse-8e9948bc-8100-407d-a2db-8cebced3e86a', focal: [0.5, 0.55],
    alt: 'The faceted grey climbing wall at Maggie Daley Park, with downtown towers behind it.' },
  { slug: 'grant-park', ledgerId: 'openverse-354c9721-3c07-4e18-af9b-ce28ea227752', focal: [0.5, 0.5],
    alt: 'Buckingham Fountain in Grant Park spraying water, with the Chicago skyline behind it under a blue sky.' },
  { slug: 'chicago-riverwalk', ledgerId: 'openverse-088a1b9a-2875-4fa3-819c-23a49ad8bc53', focal: [0.5, 0.5],
    alt: 'The Chicago Riverwalk at night: lit cafe terraces along the river, with bridges and towers beyond.' },
  { slug: 'architecture-river-cruise', ledgerId: 'openverse-5ff39d49-5377-463d-bb7b-6063052b67e3', focal: [0.5, 0.5],
    alt: 'The Chicago River seen from the water, running between downtown towers toward a bridge.' },
  { slug: 'millennium-park-walk', ledgerId: 'openverse-a6a15924-e193-4c9c-98a0-2cabaa3a05ef', focal: [0.5, 0.6],
    alt: 'Cloud Gate, the mirrored "Bean" sculpture in Millennium Park, reflecting the skyline and visitors.' },
  { slug: 'chicago-classics', ledgerId: 'openverse-3f167762-1d0f-4d2a-862c-1d04bf7a203f', focal: [0.5, 0.45],
    alt: 'A slice of Chicago deep-dish pizza lifted from the pan, strings of melted cheese under a thick tomato top.' },
  { slug: 'art-institute', ledgerId: 'openverse-35651326-d5a2-40c7-910a-1504b4be9f13', focal: [0.5, 0.5],
    alt: 'One of the bronze lions outside the Art Institute of Chicago on Michigan Avenue.' },
  { slug: 'shedd-aquarium', ledgerId: 'openverse-8b0cb7bc-9f04-4824-b5c2-3468d9960766', focal: [0.5, 0.5],
    alt: 'A beluga whale swimming in blue-green water behind the glass at Shedd Aquarium.' },
  { slug: 'griffin-msi', ledgerId: 'openverse-2882f558-a325-4650-b35a-c86b2fd50f3e', focal: [0.5, 0.5],
    alt: 'The model railroad at the Museum of Science and Industry: a train curving through a miniature city.' },
  { slug: 'chicago-botanic-garden', ledgerId: 'openverse-9f46ee13-51fe-41a9-a3e2-bb1dfd218173', focal: [0.55, 0.5],
    alt: 'A brick path beside a lawn and a row of yellow autumn trees at the Chicago Botanic Garden.' },
  { slug: 'architecture-walking-tours', ledgerId: 'openverse-8c1a77de-d85a-4ddc-98ed-b8252aa73e10', focal: [0.5, 0.5],
    alt: 'The large white scale model of downtown Chicago inside the Chicago Architecture Center.' },
  { slug: 'caa-explore', ledgerId: 'openverse-c71b807d-c3bf-47c9-b3ae-7739aabf78c2', focal: [0.5, 0.5],
    alt: 'The marble grand staircase under a coffered ceiling and chandelier in the Chicago Athletic Association Hotel.' },
  { slug: 'game-room', ledgerId: 'openverse-a2b86634-1711-4c10-8c2f-d549fd09411a', focal: [0.5, 0.5],
    alt: 'A long wooden shuffleboard table under globe lights in the Game Room at the Chicago Athletic Association.' },
  { slug: 'starbucks-reserve-roastery', ledgerId: 'openverse-f8b0a6d7-b229-4d88-9041-9955638ea9fa', focal: [0.5, 0.55],
    alt: 'The curved glass front of the Starbucks Reserve Roastery building on Michigan Avenue, behind a street tree.' },
  { slug: 'starved-rock-state-park', ledgerId: 'french-canyon-starved-rock-panoramio', focal: [0.5, 0.5],
    alt: 'French Canyon at Starved Rock State Park: sandstone walls and green trees around a narrow canyon.' },
];

function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { schema: 1, generator: 'scripts/place-photos.mjs', items: [] };
}

/** 4:3 crop around the focal point, encoded at each width the crop can hold. */
async function derive(input, slug, focal) {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(input).rotate().metadata();
  const sw = meta.autoOrient?.width ?? meta.width;
  const sh = meta.autoOrient?.height ?? meta.height;
  let w = sw;
  let h = Math.round(w / ASPECT);
  if (h > sh) {
    h = sh;
    w = Math.round(h * ASPECT);
  }
  const left = Math.min(Math.max(0, Math.round(focal[0] * sw - w / 2)), sw - w);
  const top = Math.min(Math.max(0, Math.round(focal[1] * sh - h / 2)), sh - h);
  mkdirSync(OUT, { recursive: true });
  const files = [];
  for (const width of [...new Set(WIDTHS.map((x) => Math.min(x, w)))]) {
    const base = sharp(input).rotate().extract({ left, top, width: w, height: h }).resize({ width, kernel: 'lanczos3' });
    for (const [ext, encode] of [
      ['avif', (p, q) => p.avif({ quality: q - 20, effort: 6 })],
      ['webp', (p, q) => p.webp({ quality: q, effort: 6 })],
    ]) {
      // The card's file stays under BUDGET: busy pictures (leaves, crowds) step the quality down.
      let q = 72;
      let buf = await encode(base.clone(), q).toBuffer();
      while (width <= WIDTHS[0] && buf.length > BUDGET && q > 50) {
        q -= 4;
        buf = await encode(base.clone(), q).toBuffer();
      }
      const path = join(OUT, `${slug}-${width}.${ext}`);
      writeFileSync(path, buf);
      files.push({ src: `/${rel(path).replace(/^public\//, '')}`, format: ext, width, bytes: buf.length, sha256: sha(buf) });
    }
  }
  const card = files.find((f) => f.format === 'webp' && f.width === Math.min(WIDTHS[0], w));
  return { src: card.src, intrinsic: { width: card.width, height: Math.round(card.width / ASPECT) }, files };
}

async function build() {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const byId = new Map(ledger.assets.map((a) => [a.id, a]));
  const slugs = new Set(JSON.parse(readFileSync(RECOMMENDATIONS, 'utf8')).map((r) => r.slug));
  const items = [];
  for (const p of PLACES) {
    if (!slugs.has(p.slug)) throw new Error(`${p.slug}: not a recommendation in ${rel(RECOMMENDATIONS)}`);
    const entry = byId.get(p.ledgerId);
    if (!entry?.downloaded) throw new Error(`${p.slug}: ${p.ledgerId} is not a downloaded ledger entry — fetch it through scripts/fetch-openverse.mjs first`);
    const file = join(ROOT, entry.file);
    if (sha(readFileSync(file)) !== entry.sha256) throw new Error(`${p.slug}: ${entry.file} does not match its ledger hash`);
    const derived = await derive(file, p.slug, p.focal);
    const needsCredit = Boolean(entry.license?.attributionRequired);
    items.push({
      id: `place.${p.slug}`,
      slug: p.slug,
      ...derived,
      sourceType: 'licensed-photograph',
      alt: p.alt,
      ledger: { id: entry.id, file: entry.file, sha256: entry.sha256 },
      license: entry.license.shortName,
      // CC BY / BY-SA: the credit a visitor must be able to find next to the picture; always on /credits too.
      // Title-author-source-licence: the author links to the source page, the licence name to the
      // licence itself (CC BY 2.0 §4(a) asks for its URI with every copy), and the crop is said.
      credit: needsCredit ? `Photo: ${entry.author}, cropped${entry.license.shareAlike ? ' and shared under the same licence' : ''}` : null,
      creditUrl: needsCredit ? entry.sourcePageUrl : null,
      licenseUrl: needsCredit ? entry.license.url : null,
      changes: 'Cropped to 4:3 and resized; re-encoded as AVIF and WebP.',
    });
    console.log(`✓ place.${p.slug} ← ${entry.file}`);
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify({ schema: 1, generator: 'scripts/place-photos.mjs', items }, null, 2)}\n`);
  console.log(`manifest: ${rel(MANIFEST)} (${items.length} items)`);
}

function check() {
  const m = readManifest();
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const byId = new Map(ledger.assets.map((a) => [a.id, a]));
  const problems = [];
  for (const item of m.items) {
    for (const f of item.files) {
      const path = join(ROOT, 'public', f.src);
      if (!existsSync(path)) problems.push(`${item.id}: ${f.src} missing`);
      else if (sha(readFileSync(path)) !== f.sha256) problems.push(`${item.id}: ${f.src} hash mismatch — re-run the script`);
    }
    const entry = byId.get(item.ledger?.id);
    if (!entry?.downloaded) problems.push(`${item.id}: no downloaded ledger entry`);
    else if (entry.sha256 !== item.ledger.sha256) problems.push(`${item.id}: ledger file changed since the derivatives were made — re-run the script`);
    if (entry?.license?.attributionRequired && !item.credit) problems.push(`${item.id}: ${entry.license.shortName} needs a credit line`);
    if (entry?.license?.attributionRequired && item.licenseUrl !== entry.license.url) problems.push(`${item.id}: ${entry.license.shortName} needs its licence link`);
    if (!item.alt) problems.push(`${item.id}: alt text missing`);
  }
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length) return 1;
  console.log(`✓ ${m.items.length} place photo(s) present, hash-matching and in the ledger`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === '--check') process.exit(check());
  else if (!cmd) await build();
  else {
    console.error('Usage: node scripts/place-photos.mjs [--check]');
    process.exit(2);
  }
}
