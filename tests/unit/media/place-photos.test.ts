import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toPlannerPlace } from '@/app/(guest)/guests/travel/planner-data';
import type { RecommendationCard } from '@/domain/content/views';
import { licensedPhotoCredits } from '@/domain/media/credits';
import { placePhoto, placePhotos } from '@/domain/media/place-photos';
import ledger from '../../../public/assets/attributions.json';
import recommendations from '../../../src/content/seed/recommendations.json';

/**
 * The photographs on Your Trip's place cards (scripts/place-photos.mjs). Each must be a real file, a
 * licence-ledger entry under a licence docs/ops/asset-licensing.md allows, on /credits, and the
 * picture of a recommendation that exists.
 */
const ROOT = process.cwd();
const ALLOWED = new Set(['cc0', 'pd', 'cc-by', 'cc-by-sa']);
type Asset = { id: string; file: string; sha256: string; downloaded: boolean; license: { key: string; shortName: string; url: string; attributionRequired: boolean } };
const assets = new Map((ledger.assets as Asset[]).map((a) => [a.id, a]));
const slugs = new Set((recommendations as { slug: string }[]).map((r) => r.slug));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('place photos', () => {
  const items = placePhotos();

  it('has photographs to show', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it.each(items.map((i) => [i.slug, i] as const))('%s: every file exists and matches its hash', (_slug, item) => {
    expect(item.files.some((f) => f.src === item.src && f.format === 'webp' && f.width === 640)).toBe(true);
    for (const f of item.files) {
      const path = join(ROOT, 'public', f.src);
      expect(existsSync(path), f.src).toBe(true);
      expect(sha(path), f.src).toBe(f.sha256);
      if (f.width <= 640) expect(f.bytes, f.src).toBeLessThanOrEqual(80_000);
    }
  });

  it.each(items.map((i) => [i.slug, i] as const))('%s: is a downloaded ledger entry under an allowed licence, on /credits', (_slug, item) => {
    const entry = assets.get(item.ledger.id);
    expect(entry, item.ledger.id).toBeDefined();
    expect(entry!.downloaded).toBe(true);
    expect(entry!.file).toBe(item.ledger.file);
    expect(sha(join(ROOT, entry!.file))).toBe(entry!.sha256);
    expect(entry!.sha256).toBe(item.ledger.sha256);
    expect(ALLOWED.has(entry!.license.key), entry!.license.shortName).toBe(true);
    expect(entry!.license.shortName).not.toMatch(/\b(NC|ND)\b/);
    expect(entry!.license.url).toMatch(/^https:\/\//);
    if (entry!.license.attributionRequired) {
      expect(item.credit).toContain(entry!.license.shortName);
      expect(item.creditUrl).toMatch(/^https:\/\//);
    }
    expect(licensedPhotoCredits().some((c) => c.id === entry!.id)).toBe(true);
  });

  it.each(items.map((i) => [i.slug, i] as const))('%s: is the picture of a real recommendation, described plainly', (slug, item) => {
    expect(slugs.has(slug)).toBe(true);
    expect(item.alt.length).toBeGreaterThan(20);
    expect(item.alt).not.toMatch(/^(image|photo|picture) of/i);
  });

  it('reaches the planner card through toPlannerPlace, with the credit a CC BY licence asks for', () => {
    const card = (slug: string) =>
      ({ id: slug, slug, href: `/guests/things-to-do/${slug}`, title: slug, category: 'outdoors', interests: [], what: { text: 'A place.', placeholder: false }, durationMinutes: null, kidFriendly: null, draft: false, placeholder: false, handoffs: {} }) as unknown as RecommendationCard;
    const withCredit = items.find((i) => i.credit);
    const free = items.find((i) => !i.credit);
    for (const item of [withCredit, free].filter((i) => !!i)) {
      const place = toPlannerPlace(card(item.slug));
      expect(place?.image?.src).toBe(item.src);
      expect(place?.image?.alt).toBe(item.alt);
      expect(place?.image?.credit).toEqual(item.credit ? { text: item.credit, href: item.creditUrl } : undefined);
    }
    expect(placePhoto('no-such-place')).toBeUndefined();
    expect(toPlannerPlace(card('no-such-place'))?.image).toBeUndefined();
  });
});
