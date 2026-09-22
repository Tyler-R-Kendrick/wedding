#!/usr/bin/env node
/**
 * Botanical–Deco production media: derivatives, provenance and a CI check.
 *
 *   BOTANICAL_DECO_REFERENCES=/private/path/approved-originals node scripts/botanical-deco-media.mjs couple
 *   node scripts/botanical-deco-media.mjs places        # licensed Commons photographs -> responsive derivatives
 *   BOTANICAL_DECO_REFERENCES=… node scripts/botanical-deco-media.mjs botanicals   # the approved edge flowers, paper keyed out
 *   node scripts/botanical-deco-media.mjs --check       # CI: every file in the manifest exists with its hash
 *
 * COUPLE MEDIA IS INTERIM, AND SAYS SO. Sara and Tyler authorised generated portrayals of themselves and
 * approved four page designs that contain them. No authorised image-generation provider is available to
 * this repository (docs/design/approved-botanical-deco/media-briefs.md records the exact briefs for the
 * final portraits), so — as the approved handoff permits — the portraits here are clean crops of those
 * generated portrayals cut out of the approved reference images: no browser chrome, no overlaid
 * headline, no lettering carved into the bridge pillar. Each record keeps the parent image's SHA-256 and
 * the exact crop box, and is marked `interim: true` until a high-resolution replacement lands.
 *
 * What is deliberately NOT here: the six private identity photographs and the approved reference images
 * themselves. The repository is public; the Our Story reference contains the couple's own candid
 * snapshots. `couple` therefore reads the references from a path OUTSIDE the repo and refuses to run
 * unless every file matches the hash the couple approved.
 *
 * Every derivative is re-encoded, which strips EXIF/GPS. Places and plates are derived only from files
 * already in the licence ledger (public/assets/attributions.json) and point back to that entry.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'media', 'botanical-deco');
const MANIFEST = join(OUT, 'manifest.json');
const LEDGER = join(ROOT, 'public', 'assets', 'attributions.json');

/** The four approved originals (docs/design/approved-botanical-deco/references.json). Immutable. */
export const APPROVED = {
  'REF-HOME': { file: 'sara_and_tyler_a_brighter_together.png', sha256: '53bcd6b2780087382ee0297962866ca28ca8b9a5fdac0c2337c55abec929e68a' },
  'REF-STORY': { file: 'sara_tyler_our_story.png', sha256: '0239e1569b50b345a567d3f4225ae5fc37560187a9db171fecd7b1aa274d9980' },
  'REF-EXPLORE': { file: 'sara_and_tyler_explore_chicago.png', sha256: 'deb13636d93dece0b55ca0fc8fbd2d9f57dcb7e3a2c78b9ce12440363df3d2fd' },
  'REF-WEEKEND': { file: 'sara_tyler_s_chicago_wedding_weekend.png', sha256: '3579846a32a088be1df84323e57b3afbd2be48a0477799c98fa0145a2526a9d6' },
};

/**
 * Crop boxes are [left, top, right, bottom] in the 1448×1086 source. Each was chosen by looking at the
 * source: it stops short of the overlaid hero text on the left and of the "GOOD PEOPLE…" lettering on
 * the pillar at the right, and never includes a Story snapshot (those are the couple's real photos).
 * `scales` are output widths as multiples of the crop width (lanczos3, light unsharp mask).
 */
const COUPLE = [
  { id: 'couple.hero.formal', ref: 'REF-HOME', box: [520, 118, 1265, 525], scales: [1.25, 2], focal: [0.46, 0.4],
    alt: 'Sara and Tyler cheek to cheek on a bridge over the Chicago River, the towers of downtown glowing behind them.' },
  { id: 'couple.hero.formal.mobile', ref: 'REF-HOME', box: [620, 118, 1120, 525], scales: [1.3, 2.3], focal: [0.5, 0.36],
    alt: 'Sara and Tyler cheek to cheek on a bridge over the Chicago River.' },
  { id: 'couple.hero.story', ref: 'REF-STORY', box: [545, 110, 1288, 390], scales: [1.25, 2], focal: [0.4, 0.42],
    alt: 'Sara laughing up at Tyler as he smiles back, the Chicago skyline soft behind them.' },
  { id: 'couple.hero.story.mobile', ref: 'REF-STORY', box: [590, 110, 1060, 390], scales: [1.3, 2.3], focal: [0.45, 0.4],
    alt: 'Sara laughing up at Tyler as he smiles back.' },
  { id: 'couple.hero.explore', ref: 'REF-EXPLORE', box: [580, 108, 1280, 445], scales: [1.25, 2], focal: [0.5, 0.38],
    alt: 'Sara and Tyler together by the Chicago River at dusk, the city lit up behind them.' },
  { id: 'couple.hero.explore.mobile', ref: 'REF-EXPLORE', box: [760, 108, 1210, 445], scales: [1.3, 2.3], focal: [0.45, 0.36],
    alt: 'Sara and Tyler together by the Chicago River at dusk.' },
  { id: 'couple.hero.weekend', ref: 'REF-WEEKEND', box: [452, 112, 938, 398], scales: [1.4, 2.2], focal: [0.55, 0.38],
    alt: 'Sara and Tyler smiling together on a bridge over the Chicago River.' },
  { id: 'couple.hero.weekend.mobile', ref: 'REF-WEEKEND', box: [590, 112, 938, 398], scales: [1.4, 2.6], focal: [0.45, 0.36],
    alt: 'Sara and Tyler smiling together on a bridge over the Chicago River.' },
  { id: 'couple.story.monochrome', ref: 'REF-HOME', box: [421, 528, 724, 746], scales: [1.5, 2.6], focal: [0.55, 0.4],
    alt: 'Black-and-white portrait: Sara looking up at Tyler, both smiling.' },
  { id: 'couple.lakefront', ref: 'REF-HOME', box: [561, 862, 889, 1025], scales: [1.5, 2.6], focal: [0.9, 0.4],
    alt: 'Sara and Tyler on the Lake Michigan shore with the downtown skyline across the water.' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { schema: 1, generator: 'scripts/botanical-deco-media.mjs', items: [] };
}
function writeManifest(m) {
  m.items.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}
function upsert(m, item) {
  const i = m.items.findIndex((x) => x.id === item.id);
  if (i >= 0) m.items[i] = item;
  else m.items.push(item);
}

async function encode(sharp, pipeline, base, width) {
  const out = [];
  for (const [ext, fmt] of [['avif', { quality: 58, effort: 6 }], ['jpg', { quality: 82, mozjpeg: true, progressive: true }]]) {
    const file = `${base}-${width}.${ext}`;
    const p = pipeline.clone();
    const buf = ext === 'avif' ? await p.avif(fmt).toBuffer() : await p.jpeg(fmt).toBuffer();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    out.push({ src: '/' + rel(file).replace(/^public\//, ''), format: ext, width, bytes: buf.length, sha256: sha(buf) });
  }
  return out;
}

function verifiedReferences() {
  const refs = process.env.BOTANICAL_DECO_REFERENCES;
  if (!refs || !existsSync(refs)) {
    console.error('set BOTANICAL_DECO_REFERENCES to the private approved-originals directory (never inside this repo).');
    process.exit(2);
  }
  if (resolve(refs).startsWith(ROOT)) {
    console.error('BOTANICAL_DECO_REFERENCES points inside the repository; the approved originals must stay out of it.');
    process.exit(2);
  }
  for (const [id, r] of Object.entries(APPROVED)) {
    const got = sha(readFileSync(join(refs, r.file)));
    if (got !== r.sha256) {
      console.error(`${id} ${r.file} hash ${got} does not match the approved ${r.sha256}. Refusing to derive from an unapproved image.`);
      process.exit(1);
    }
  }
  return refs;
}

async function couple() {
  const refs = verifiedReferences();
  const { default: sharp } = await import('sharp');
  const m = readManifest();
  for (const c of COUPLE) {
    const src = join(refs, APPROVED[c.ref].file);
    const [l, t, r, b] = c.box;
    const w = r - l;
    const h = b - t;
    const base = join(OUT, 'couple', c.id.replace(/^couple\./, '').replace(/\./g, '-'));
    const files = [];
    for (const s of c.scales) {
      const width = Math.round((w * s) / 10) * 10;
      const pipeline = sharp(src).extract({ left: l, top: t, width: w, height: h }).resize({ width, kernel: 'lanczos3' }).sharpen({ sigma: 0.7, m1: 0.6, m2: 1.4 });
      files.push(...(await encode(sharp, pipeline, base, width)));
    }
    upsert(m, {
      id: c.id,
      kind: 'couple',
      sourceType: 'generated-portrayal',
      provenance: `Generated portrayal of Sara and Tyler (authorised by them), cropped from the approved design reference ${c.ref}. Not a documentary photograph of any event.`,
      interim: true,
      interimReason: 'No authorised image-generation provider is configured; this is a crop of the approved mockup at its native resolution, upscaled. Replace with the high-resolution portrait in docs/design/approved-botanical-deco/media-briefs.md.',
      parent: { reference: c.ref, file: APPROVED[c.ref].file, sha256: APPROVED[c.ref].sha256, box: c.box },
      intrinsic: { width: w, height: h },
      aspect: +(w / h).toFixed(4),
      focal: c.focal,
      alt: c.alt,
      credit: 'Generated portrayal, approved by Sara and Tyler',
      scope: 'public',
      files,
    });
    console.log(`couple: ${c.id} ${w}×${h} -> ${files.filter((f) => f.format === 'jpg').map((f) => f.width).join(', ')}`);
  }
  writeManifest(m);
}

/**
 * The edge botanicals. The approved design's flowers are painterly ivory blossoms and olive leaves
 * that enter from the page edge, drawn by the same generator as the portraits and approved with them.
 * Line-art stems would be exactly the "tiny generic line icons" the handoff rejects, and a public-domain
 * plate is a different flower in a different hand. So the sprigs are lifted from the approved images
 * where they sit on plain paper (never over a photograph or a snapshot), the paper is keyed out to
 * alpha, and each keeps its parent hash and box like the portraits do.
 *
 * `anchored` names the sides where the sprig runs off the page: those are only seeded by pixels that
 * are paper AND no brighter than paper, so a white petal cut by the page edge is not flooded away.
 */
const BOTANICALS = [
  { id: 'botanical.corner-tl', ref: 'REF-STORY', box: [0, 111, 138, 389], anchored: ['left', 'top'] },
  { id: 'botanical.cluster-tl', ref: 'REF-EXPLORE', box: [0, 108, 152, 340], anchored: ['left', 'top'] },
  { id: 'botanical.edge-left-tall', ref: 'REF-HOME', box: [0, 532, 88, 858], anchored: ['left'] },
  { id: 'botanical.edge-left', ref: 'REF-WEEKEND', box: [0, 440, 92, 760], anchored: ['left'] },
  { id: 'botanical.edge-right', ref: 'REF-HOME', box: [1325, 718, 1448, 861], anchored: ['right'] },
  { id: 'botanical.sprig-right', ref: 'REF-STORY', box: [1318, 606, 1446, 752], anchored: ['right'] },
  { id: 'botanical.vine-right', ref: 'REF-WEEKEND', box: [1396, 446, 1448, 1036], anchored: ['right'] },
];

/** Paper -> alpha: flood from the free sides, then close flat paper pockets between leaves. */
function keyPaper(data, w, h, anchored, T = 16) {
  const samples = [];
  for (let i = 0; i < w * h; i++) {
    const R = data[i * 3], G = data[i * 3 + 1], B = data[i * 3 + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx > 225 && mx - mn < 22) samples.push([R, G, B]);
  }
  const med = [0, 1, 2].map((c) => samples.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
  const dist = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = Math.hypot(data[i * 3] - med[0], data[i * 3 + 1] - med[1], data[i * 3 + 2] - med[2]);
  const lum = (i) => 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  const paperL = 0.2126 * med[0] + 0.7152 * med[1] + 0.0722 * med[2];
  const bg = new Uint8Array(w * h);
  const q = [];
  const seed = (x, y) => {
    const i = y * w + x;
    if (!bg[i] && dist[i] < T) {
      bg[i] = 1;
      q.push(i);
    }
  };
  const seedA = (x, y) => {
    const i = y * w + x;
    if (dist[i] < T * 0.7 && lum(i) <= paperL + 2) seed(x, y);
  };
  for (let x = 0; x < w; x++) {
    (anchored.includes('top') ? seedA : seed)(x, 0);
    (anchored.includes('bottom') ? seedA : seed)(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    (anchored.includes('left') ? seedA : seed)(0, y);
    (anchored.includes('right') ? seedA : seed)(w - 1, y);
  }
  while (q.length) {
    const i = q.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  const seen = new Uint8Array(w * h);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (bg[i0] || seen[i0] || dist[i0] >= T * 0.8) continue;
    const comp = [];
    const st = [i0];
    seen[i0] = 1;
    let sumL = 0;
    while (st.length) {
      const i = st.pop();
      comp.push(i);
      sumL += lum(i);
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && !bg[j] && dist[j] < T * 0.8) {
          seen[j] = 1;
          st.push(j);
        }
      }
    }
    if (comp.length > 30 && sumL / comp.length <= paperL + 1.5) for (const i of comp) bg[i] = 1;
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let a = 255;
    if (bg[i]) a = 0;
    else {
      const x = i % w, y = (i / w) | 0;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bg[yy * w + xx]) { near = true; break; }
      }
      if (near) a = Math.max(0, Math.min(255, Math.round(((dist[i] - T * 0.5) / (T * 2)) * 255)));
    }
    const al = a / 255;
    for (let c = 0; c < 3; c++) {
      let v = data[i * 3 + c];
      if (al > 0 && al < 1) v = (v - med[c] * (1 - al)) / al;
      rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

async function botanicals() {
  const refs = verifiedReferences();
  const { default: sharp } = await import('sharp');
  const m = readManifest();
  for (const b of BOTANICALS) {
    const [l, t, r, btm] = b.box;
    const w = r - l, h = btm - t;
    const { data } = await sharp(join(refs, APPROVED[b.ref].file)).extract({ left: l, top: t, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgba = keyPaper(data, w, h, b.anchored);
    const files = [];
    for (const s of [1, 2]) {
      const width = w * s;
      const buf = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).resize({ width, kernel: 'lanczos3' }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toBuffer();
      const file = join(OUT, 'botanical', `${b.id.replace(/^botanical\./, '')}-${width}.webp`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buf);
      files.push({ src: '/' + rel(file).replace(/^public\//, ''), format: 'webp', width, bytes: buf.length, sha256: sha(buf) });
    }
    upsert(m, {
      id: b.id,
      kind: 'ornament',
      sourceType: 'generated-ornament',
      provenance: `Painted botanical from the approved design reference ${b.ref}, paper keyed to transparency. Decorative only.`,
      interim: true,
      interimReason: 'Lifted at the mockup\'s native resolution; replace with a high-resolution cutout from the same brief (media-briefs.md, botanical.edges).',
      parent: { reference: b.ref, file: APPROVED[b.ref].file, sha256: APPROVED[b.ref].sha256, box: b.box },
      intrinsic: { width: w, height: h },
      aspect: +(w / h).toFixed(4),
      anchored: b.anchored,
      alt: '',
      credit: 'Generated botanical, approved by Sara and Tyler',
      scope: 'public',
      files,
    });
    console.log(`botanicals: ${b.id} ${w}×${h}`);
  }
  writeManifest(m);
}

/** Licensed photographs from the Commons ledger -> responsive derivatives (slot -> ledger file). */
export const PLACES = [];

async function places() {
  const { default: sharp } = await import('sharp');
  const ledger = JSON.parse(readFileSync(LEDGER, 'utf8'));
  const entries = Array.isArray(ledger) ? ledger : ledger.assets ?? ledger.items ?? [];
  const slots = JSON.parse(readFileSync(join(ROOT, 'docs', 'design', 'approved-botanical-deco', 'place-slots.json'), 'utf8'));
  const m = readManifest();
  for (const s of slots) {
    const entry = entries.find((e) => e.file === s.file);
    if (!entry) {
      console.error(`places: ${s.id} -> ${s.file} has no licence-ledger entry; run scripts/fetch-commons.mjs first.`);
      process.exit(1);
    }
    const src = join(ROOT, s.file);
    const meta = await sharp(src).metadata();
    const [l, t, r, b] = s.box ?? [0, 0, meta.width, meta.height];
    const base = join(OUT, s.kind === 'venue' ? 'venue' : 'city', s.id.replace(/^(venue|city)\./, '').replace(/\./g, '-'));
    const files = [];
    for (const width of s.widths) {
      const pipeline = sharp(src).rotate().extract({ left: l, top: t, width: r - l, height: b - t }).resize({ width, kernel: 'lanczos3', withoutEnlargement: true }).modulate(s.modulate ?? {});
      files.push(...(await encode(sharp, pipeline, base, width)));
    }
    upsert(m, {
      id: s.id,
      kind: s.kind,
      sourceType: 'licensed-photograph',
      provenance: `${entry.title} by ${entry.author ?? entry.creator ?? 'unknown'} — ${entry.license?.shortName ?? entry.license}. Cropped and resized; subject verified from the Commons description.`,
      interim: false,
      parent: { ledgerFile: s.file, sha256: entry.sha256 ?? null, box: [l, t, r, b] },
      intrinsic: { width: r - l, height: b - t },
      aspect: +((r - l) / (b - t)).toFixed(4),
      focal: s.focal ?? [0.5, 0.5],
      alt: s.alt,
      caption: s.caption ?? null,
      credit: entry.attribution ?? `${entry.author} / ${entry.license?.shortName ?? ''}`,
      scope: 'public',
      files,
    });
    console.log(`places: ${s.id} -> ${files.filter((f) => f.format === 'jpg').map((f) => f.width).join(', ')}`);
  }
  writeManifest(m);
}

function check() {
  const m = readManifest();
  let bad = 0;
  for (const item of m.items) {
    for (const f of item.files ?? []) {
      const p = join(ROOT, 'public', f.src);
      if (!existsSync(p)) {
        console.error(`check: ${item.id}: ${f.src} is missing`);
        bad++;
        continue;
      }
      if (sha(readFileSync(p)) !== f.sha256) {
        console.error(`check: ${item.id}: ${f.src} does not match its recorded hash`);
        bad++;
      }
    }
    if (!item.alt && item.kind !== 'ornament') {
      console.error(`check: ${item.id} has no alt text`);
      bad++;
    }
    if ((item.kind === 'couple' || item.sourceType === 'generated-ornament') && !item.parent?.sha256) {
      console.error(`check: ${item.id} has no parent hash`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(`botanical-deco media: ${m.items.length} items, every derivative present and hash-matching.`);
}

const cmd = process.argv[2];
if (cmd === '--check') check();
else if (cmd === 'couple') await couple();
else if (cmd === 'places') await places();
else if (cmd === 'botanicals') await botanicals();
else {
  console.error('usage: botanical-deco-media.mjs couple | botanicals | places | --check');
  process.exit(2);
}
