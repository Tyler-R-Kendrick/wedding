#!/usr/bin/env node
/**
 * One-off helper: merge same-day / same-trip photo adventures in the content seed.
 * Run from repo root: node scripts/merge-adventure-events.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const seedPath = join(process.cwd(), 'src/content/seed/adventures.json');
const manifestPath = join(process.cwd(), 'docs/content/adventure-photos.json');

/** @type {{ slug: string; from: string[]; title: string; summary: string; dateApprox?: string; locationLabel?: string; lat?: number; lng?: number; tags?: string[] }[]} */
const GROUPS = [
  {
    slug: 'alinea-2026-02-13',
    from: ['alinea-2026-02-13-a', 'alinea-2026-02-13-b', 'alinea-2026-02-13-c'],
    title: 'Alinea',
    summary: 'An evening at Alinea, 1723 N Halsted.',
  },
  {
    slug: 'ever-2025-02-13',
    from: ['ever-2025-02-13-a', 'ever-2025-02-13-b', 'ever-2025-02-13-c'],
    title: 'Ever',
    summary: 'Ever, 1340 W Fulton, on the eve of Valentine\'s Day.',
  },
  {
    slug: 'esme-2024-02-17',
    from: ['esme-2024-02-17-a', 'esme-2024-02-17-b', 'esme-2024-02-17-c', 'esme-2024-02-17-d'],
    title: 'Esmé',
    summary: 'Dinner at Esmé, 2200 N Clark.',
  },
  {
    slug: 'eleven-madison-park-2025-08-07',
    from: ['eleven-madison-park-2025-08-07-a', 'eleven-madison-park-2025-08-07-b', 'eleven-madison-park-2025-08-07-c'],
    title: 'Eleven Madison Park',
    summary: 'Eleven Madison Park, 11 Madison Ave.',
  },
  {
    slug: 'richardson-farm-2025-10-11',
    from: ['richardson-farm-2025-10-11-a', 'richardson-farm-2025-10-11-b'],
    title: 'Richardson Farm, 2025',
    summary: 'Pumpkin season at Richardson Farm, 2025.',
  },
  {
    slug: 'copenhagen-denmark-2025',
    from: ['noma-2025-06-24', 'geranium-2025-06-26', 'tivoli-gardens-2025-06-30-a', 'tivoli-gardens-2025-06-30-b'],
    title: 'Copenhagen, Denmark',
    summary: 'Noma, Geranium, and Tivoli Gardens in Copenhagen.',
    dateApprox: '24 June – 30 June 2025',
    locationLabel: 'Copenhagen, Denmark',
    lat: 55.68251,
    lng: 12.61083,
    tags: ['travel', 'hospitality', 'place'],
  },
];

const adventures = JSON.parse(readFileSync(seedPath, 'utf8'));
const bySlug = new Map(adventures.map((a) => [a.slug, a]));
const remove = new Set();
const redirects = [];

for (const g of GROUPS) {
  const parts = g.from.map((s) => {
    const row = bySlug.get(s);
    if (!row) throw new Error(`missing adventure ${s}`);
    return row;
  });
  const base = { ...parts[0] };
  base.slug = g.slug;
  base.title = g.title;
  base.summary = g.summary;
  base.media = parts.flatMap((p) => p.media);
  if (g.dateApprox) base.dateApprox = g.dateApprox;
  if (g.locationLabel) base.locationLabel = g.locationLabel;
  if (g.lat !== undefined) base.lat = g.lat;
  if (g.lng !== undefined) base.lng = g.lng;
  if (g.tags) base.tags = g.tags;
  bySlug.set(g.slug, base);
  for (const old of g.from) {
    if (old === g.slug) continue;
    remove.add(old);
    redirects.push({ source: `/our-adventures/${old}`, destination: `/our-adventures/${g.slug}`, permanent: true });
  }
}

const merged = [];
const seen = new Set();
for (const a of adventures) {
  if (remove.has(a.slug)) continue;
  const row = bySlug.get(a.slug) ?? a;
  if (seen.has(row.slug)) continue;
  seen.add(row.slug);
  merged.push(row);
}
for (const g of GROUPS) {
  if (!seen.has(g.slug)) {
    merged.push(bySlug.get(g.slug));
    seen.add(g.slug);
  }
}
writeFileSync(seedPath, `${JSON.stringify(merged, null, 2)}\n`);

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const slugMap = Object.fromEntries(GROUPS.flatMap((g) => g.from.map((old) => [old, g.slug])));
for (const p of manifest.photos) {
  if (slugMap[p.adventure]) p.adventure = slugMap[p.adventure];
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Merged ${GROUPS.length} groups; removed ${remove.size} slugs; ${merged.length} adventures remain.`);
console.log('Redirects to add:', redirects.length);
writeFileSync(join(process.cwd(), 'scripts/.merge-adventure-redirects.json'), `${JSON.stringify(redirects, null, 2)}\n`);
