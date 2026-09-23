#!/usr/bin/env node
/**
 * Our Story timeline media: responsive derivatives + a manifest the ride reads.
 *
 *   node scripts/timeline-media.mjs placeholders   # stand-in photographs from the licence ledger -> public/media/timeline
 *   node scripts/timeline-media.mjs --check        # CI: every manifest file exists with its hash, every stand-in points at the ledger
 *
 * `derivePhoto()` is exported for scripts/import-paired.mjs, which runs the couple's own Paired photos
 * through the same encoder (and only when they ask it to — see docs/content/paired-timeline.md).
 *
 * A timeline record never names a derivative. It names one `src` (the largest JPEG) and the ride looks
 * that path up here for the srcset, the intrinsic size, whether the picture is a stand-in, and the
 * credit line a licence may require. Replacing a stand-in with the couple's photo is a new `src` on the
 * record and nothing else.
 *
 * Stand-ins come only from files already in public/assets/attributions.json (fetched through
 * scripts/fetch-openverse.mjs / fetch-commons.mjs) and each item keeps that entry's id and SHA-256.
 * Every derivative is re-encoded, which strips EXIF/GPS.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'public', 'media', 'timeline');
const MANIFEST = join(OUT, 'manifest.json');
const LEDGER = join(ROOT, 'public', 'assets', 'attributions.json');
const WIDTHS = [560, 1024];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

/**
 * One stand-in per station that has a picture. Each is a real, openly licensed photograph of the kind
 * of place or thing the station names — never a stranger's portrait, never a picture of the actual
 * business passed off as ours. Alt text describes what is in the frame, not what it stands in for.
 */
const STAND_INS = [
  { slug: 'allison-and-jamies-wedding', ledgerId: 'openverse-3ee715e3-9c59-406a-bf4d-b4501adbc330', focal: [0.5, 0.55],
    alt: 'A wedding reception table set with roses, glassware and white chair covers.' },
  { slug: 'museum-of-ice-cream', ledgerId: 'openverse-7ce84247-ecd1-4a8b-b174-41cc4f224c24', focal: [0.5, 0.45],
    alt: 'A scoop of raspberry sorbet in a cone, held up against a pale wall.' },
  { slug: 'richardson-farm', ledgerId: 'openverse-07acfc79-a8eb-439f-8340-fdba6c4d56ce', focal: [0.5, 0.6],
    alt: 'White barns beyond a field of ripe grain under a grey sky.' },
  { slug: 'michael-jordans-steakhouse', ledgerId: 'openverse-0a5c6a0b-a959-4440-ac41-a05205573073', focal: [0.4, 0.5],
    alt: 'A plated steak with greens beside wine glasses on a dark restaurant table.' },
  { slug: 'food-tastings', ledgerId: 'openverse-6b70e09a-7a82-4656-bc05-57b4b9da5fc3', focal: [0.5, 0.5],
    alt: 'Wine bottles and empty tasting glasses lined up on a wooden bar with tasting sheets.' },
  { slug: 'gardening-together', ledgerId: 'openverse-1d05b38a-cee0-42a6-a289-9df2910f1abd', focal: [0.5, 0.5],
    alt: 'A garden harvest in a green tub: red potatoes, beets, courgettes and beans.' },
  { slug: 'madison-waterfront', ledgerId: 'openverse-db1018a2-8689-4e8c-8ea5-8fa6383ddac4', focal: [0.6, 0.6],
    alt: 'Bright red kayaks on a wooden dock at the edge of Lake Monona in Madison, Wisconsin.' },
  { slug: 'starved-rock', ledgerId: 'french-canyon-starved-rock-panoramio', focal: [0.5, 0.5],
    alt: 'French Canyon at Starved Rock State Park: sandstone walls and green trees around a narrow canyon.' },
  { slug: 'greater-together', ledgerId: 'openverse-1bd02025-fc88-43ac-8abd-2b8ca62ec7e5', focal: [0.5, 0.45],
    alt: 'The Chicago skyline across Lake Michigan at sunrise, the sky pink and gold.' },
  { slug: 'the-proposal', ledgerId: 'openverse-3c56dd7f-e22e-4e20-9a74-08b9a363660c', focal: [0.55, 0.5],
    alt: 'A close-up of a pale pink diamond ring resting on sparkling beads.' },
];

export function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { schema: 1, generator: 'scripts/timeline-media.mjs', items: [] };
}

export function writeManifest(m) {
  m.items.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

function upsert(m, item) {
  m.items = m.items.filter((i) => i.id !== item.id);
  m.items.push(item);
}

/**
 * Encodes one photograph into WIDTHS × {avif, jpg} under public/media/timeline/<slug>-<w>.<ext>, 4:3,
 * cropped around `focal`. Returns the manifest item minus provenance, which the caller adds.
 */
export async function derivePhoto(input, slug, { focal = [0.5, 0.5], aspect = 4 / 3 } = {}) {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(input).rotate().metadata();
  const sw = meta.autoOrient?.width ?? meta.width;
  const sh = meta.autoOrient?.height ?? meta.height;
  // Largest 4:3 box that fits, centred on the focal point and clamped to the frame.
  let w = sw;
  let h = Math.round(w / aspect);
  if (h > sh) {
    h = sh;
    w = Math.round(h * aspect);
  }
  const left = Math.min(Math.max(0, Math.round(focal[0] * sw - w / 2)), sw - w);
  const top = Math.min(Math.max(0, Math.round(focal[1] * sh - h / 2)), sh - h);
  mkdirSync(OUT, { recursive: true });
  const files = [];
  // The smaller width, and the larger one capped at what the crop actually holds (never upscaled).
  const widths = [...new Set([Math.min(WIDTHS[0], w), Math.min(WIDTHS[1], w)])];
  for (const width of widths) {
    const base = sharp(input).rotate().extract({ left, top, width: w, height: h }).resize({ width: Math.min(width, w), kernel: 'lanczos3' });
    for (const [ext, encode] of [
      ['avif', (p) => p.avif({ quality: 56, effort: 6 })],
      ['jpg', (p) => p.jpeg({ quality: 80, mozjpeg: true, progressive: true })],
    ]) {
      const buf = await encode(base.clone()).toBuffer();
      const path = join(OUT, `${slug}-${width}.${ext}`);
      writeFileSync(path, buf);
      files.push({ src: `/${rel(path).replace(/^public\//, '')}`, format: ext, width: Math.min(width, w), bytes: buf.length, sha256: sha(buf) });
    }
  }
  const largest = files.filter((f) => f.format === 'jpg').sort((a, b) => b.width - a.width)[0];
  return { src: largest.src, intrinsic: { width: largest.width, height: Math.round(largest.width / aspect) }, files };
}

async function placeholders() {
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const byId = new Map(ledger.assets.map((a) => [a.id, a]));
  const m = readManifest();
  for (const s of STAND_INS) {
    const entry = byId.get(s.ledgerId);
    if (!entry?.downloaded) throw new Error(`${s.slug}: ${s.ledgerId} is not a downloaded ledger entry — fetch it through scripts/fetch-openverse.mjs first`);
    const file = join(ROOT, entry.file);
    const buf = readFileSync(file);
    if (sha(buf) !== entry.sha256) throw new Error(`${s.slug}: ${entry.file} does not match its ledger hash`);
    const derived = await derivePhoto(file, s.slug, { focal: s.focal });
    const needsCredit = Boolean(entry.license?.attributionRequired);
    upsert(m, {
      id: `timeline.${s.slug}`,
      ...derived,
      standIn: true,
      sourceType: 'licensed-photograph',
      alt: s.alt,
      ledger: { id: entry.id, file: entry.file, sha256: entry.sha256 },
      license: entry.license?.shortName ?? null,
      // Shown on the card only when the licence asks for it (CC BY / BY-SA); always on /credits.
      credit: needsCredit ? `Photo: ${entry.author}, ${entry.license.shortName}${entry.license.shareAlike ? ' (this crop is shared under the same licence)' : ''}` : null,
      creditUrl: needsCredit ? entry.sourcePageUrl : null,
    });
    console.log(`✓ timeline.${s.slug} ← ${entry.file}`);
  }
  writeManifest(m);
  console.log(`manifest: ${rel(MANIFEST)} (${m.items.length} items)`);
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
    if (item.standIn && !byId.get(item.ledger?.id)?.downloaded) problems.push(`${item.id}: stand-in without a downloaded ledger entry`);
    if (!item.alt) problems.push(`${item.id}: alt text missing`);
  }
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length) return 1;
  console.log(`✓ ${m.items.length} timeline media item(s) present and hash-matching`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  if (cmd === '--check') process.exit(check());
  else if (cmd === 'placeholders') await placeholders();
  else {
    console.error('Usage: node scripts/timeline-media.mjs placeholders | --check');
    process.exit(2);
  }
}
