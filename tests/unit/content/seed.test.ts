import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rightsXmp } from '../../../scripts/stamp-photo-rights.mjs';
import { adventureMemorySeedSchema, crossReferenceProblems, isPlaceholderText, loadContentSeed, PLACEHOLDER_MARKER, storySectionSeedSchema } from '@/content';

const seed = loadContentSeed();

describe('content seed (facts from docs/design/brief.md only)', () => {
  it('validates against the zod schemas with provenance on every record', () => {
    const all = [...seed.story, ...seed.places, ...seed.adventures, ...seed.recommendations, ...seed.itineraries, ...seed.venueSpaces, ...seed.venueFacts, ...seed.operationalFields, ...seed.faq];
    expect(all.length).toBeGreaterThan(40);
    for (const r of all) {
      expect(r.sourceKey).toBeTruthy();
      expect(r.sourceType).toBeTruthy();
      expect(Date.parse(r.verifiedAt)).not.toBeNaN();
      expect(['TRUSTED_WEDDING', 'EXTERNAL_DATA']).toContain(r.trustClass);
      if (r.sourceType === 'official-web') expect(r.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('enforces the placeholder invariant: TODO text without placeholder: true is rejected', () => {
    const bad = storySectionSeedSchema.safeParse({ ...seed.story[0], placeholder: false });
    expect(bad.success).toBe(false);
    const ok = storySectionSeedSchema.safeParse({ ...seed.story[0], placeholder: true });
    expect(ok.success).toBe(true);
  });

  it('memories only the brief knows stay private drafts with placeholder copy; Starved Rock is public', () => {
    const briefOnly = seed.adventures.filter((a) => a.editedBy === 'seed:brief-2026-09-04' && !a.media.length);
    expect(briefOnly.length).toBeGreaterThan(0);
    for (const a of briefOnly) {
      expect(a.placeholder, a.slug).toBe(true);
      expect(a.visibility, a.slug).toBe('private-draft');
    }
    const starved = seed.adventures.find((a) => a.slug === 'starved-rock')!;
    expect(starved.visibility).toBe('public');
    expect(starved.summary).toContain('I love you');
    // No invented trail, date, or wording: the memory body is a typed placeholder, even with a photo.
    expect(starved.memory.every(isPlaceholderText)).toBe(true);
    expect(starved.dateExact).toBeUndefined();
    expect(starved.dateApprox).toBeUndefined();
    expect(isPlaceholderText(starved.saraMemory)).toBe(true);
    expect(isPlaceholderText(starved.tylerMemory)).toBe(true);
  });

  it("every one of the couple's photos is its own adventure, located from the photo or flagged as unknown", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'docs/content/adventure-photos.json'), 'utf8')) as { photos: { file: string | null; adventure: string; consent: string }[] };
    expect(manifest.photos).toHaveLength(61);
    const bySlug = new Map(seed.adventures.map((a) => [a.slug, a]));
    const files = new Set<string>();
    for (const m of manifest.photos) {
      const a = bySlug.get(m.adventure)!;
      expect(a, m.adventure).toBeDefined();
      expect(a.media, a.slug).toHaveLength(1);
      const src = a.media[0]!.src;
      const pending = m.consent.startsWith('pending');
      if (pending) {
        // Anyone else in the frame agrees first (docs/ops/asset-licensing.md section 4): until then the
        // photo is not in the repo at all, not even as a file under public/, and its adventure is a draft.
        expect(src, a.slug).toBeUndefined();
        expect(m.file, a.slug).toBeNull();
        expect(a.visibility, a.slug).toBe('private-draft');
      } else {
        expect(src, a.slug).toBe(`/assets/photos/adventures/${m.file}`);
        expect(existsSync(join(process.cwd(), 'public', src!)), src).toBe(true);
        files.add(src!);
        // The brief's own drafts (the museum, the first farm visit) stay drafts with a photo added.
        const briefDraft = a.editedBy === 'seed:brief-2026-09-04' && a.slug !== 'starved-rock';
        expect(a.visibility, a.slug).toBe(briefDraft ? 'private-draft' : 'public');
      }
      // The memory itself is the couple's to write: nothing but placeholders or nothing at all.
      expect(a.memory.every(isPlaceholderText), a.slug).toBe(true);
      const located = (a.lat !== undefined && a.lng !== undefined) || !!a.placeSlug;
      // A photo with no location in it says so, rather than being pinned somewhere plausible.
      if (!located) expect(isPlaceholderText(a.locationLabel ?? ''), a.slug).toBe(true);
    }
    // Only the manifest's files are published, and each once; the postcards' 800px copies
    // (scripts/photo-renditions.mjs) are of those files and no others.
    const published = [...files].map((f) => f.split('/').pop()).sort();
    const dir = join(process.cwd(), 'public/assets/photos/adventures');
    expect(readdirSync(dir).filter((f) => f !== '800').sort()).toEqual(published);
    for (const f of readdirSync(join(dir, '800'))) expect(published, `800/${f}`).toContain(f);
    // Every public adventure's title is its own, so its links and pins say which one they are.
    const titles = seed.adventures.filter((a) => a.visibility === 'public').map((a) => a.title);
    expect(new Set(titles).size).toBe(titles.length);
    // Homes are pinned to the neighbourhood (two decimals, about a kilometre), never to the door.
    for (const slug of ['new-years-eve-2023', 'new-years-eve-2024', 'new-years-eve-2025', 'fresno-2024-12-22', 'fresno-christmas-2025', 'ocean-beach-nj-2025-08-16', 'river-west-2025-08-24', 'door-county-2024-09-24']) {
      const a = bySlug.get(slug)!;
      expect(a.lat! * 100, slug).toBeCloseTo(Math.round(a.lat! * 100), 6);
      expect(a.lng! * 100, slug).toBeCloseTo(Math.round(a.lng! * 100), 6);
    }
  });

  it('every itinerary is a draft and the kit spaces say their capacities are the venue\'s own, unconfirmed', () => {
    expect(seed.itineraries.every((i) => i.draft)).toBe(true);
    expect(seed.itineraries.map((i) => i.bucket).sort()).toEqual(['2-3-h', '45-min', 'architecture', 'food-drink', 'friday-afternoon', 'saturday-morning', 'stay-inside-caa', 'with-kids']);
    expect(seed.venueSpaces).toHaveLength(4);
    for (const s of seed.venueSpaces) expect(s.capacities.note).toMatch(/venue's own figures.*not confirmed/);
  });

  it('the closed outlets are expired records; current outlets link to official pages checked today', () => {
    const milk = seed.operationalFields.find((o) => o.key === 'outlet.milk-room')!;
    const cherry = seed.operationalFields.find((o) => o.key === 'outlet.cherry-circle-room')!;
    expect(Date.parse(milk.validUntil!)).toBeLessThan(Date.parse('2025-03-02T00:00:00Z'));
    expect(Date.parse(cherry.validUntil!)).toBeLessThan(Date.parse('2024-05-02T00:00:00Z'));
    const current = seed.operationalFields.filter((o) => (o.kind === 'outlet' || o.kind === 'amenity') && !o.validUntil);
    expect(current.map((o) => o.label).sort()).toEqual(['Cindy\'s (rooftop)', 'Drawing Room', 'Fairgrounds', 'Game Room', 'Midōsuji', 'Shake Shack', 'The Ives', 'Topgolf Swing Suite']);
    for (const o of current) {
      expect(o.url).toMatch(/^https:\/\/www\.chicagoathletichotel\.com\//);
      expect(o.verifiedAt.startsWith('2026-09-05')).toBe(true);
    }
  });

  it('never publishes the historic-district designation date', () => {
    const district = seed.venueFacts.find((f) => f.slug === 'historic-district')!;
    expect(district.statement).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(district.note).toMatch(/not published/);
  });

  it('flags broken cross references and a why-layer without a memory', () => {
    const broken = { ...seed, adventures: seed.adventures.map((a, i) => (i === 0 ? { ...a, placeSlug: 'nowhere' } : a)) };
    expect(crossReferenceProblems(broken)).toEqual([expect.stringContaining('unknown place "nowhere"')]);
    const orphanWhy = { ...seed, recommendations: seed.recommendations.map((r, i) => (i === 0 ? { ...r, experienceSlug: undefined, whyWeShareThis: 'because' } : r)) };
    expect(crossReferenceProblems(orphanWhy).join('\n')).toMatch(/needs an experienceSlug/);
    expect(crossReferenceProblems(seed)).toEqual([]);
  });

  it('placeholder marker helper', () => {
    expect(isPlaceholderText(`x ${PLACEHOLDER_MARKER} y`)).toBe(true);
    expect(isPlaceholderText('plain')).toBe(false);
    expect(adventureMemorySeedSchema.safeParse({ ...seed.adventures[0], slug: 'Bad Slug' }).success).toBe(false);
  });
});

describe("the couple's adventure photos", () => {
  it('are published without EXIF or GPS, carrying only the rights statement as XMP', async () => {
    const sharp = (await import('sharp')).default;
    const expected = rightsXmp();
    expect(expected).toContain('DMI-PROHIBITED');
    expect(expected).not.toMatch(/exif:|GPS|tiff:|xmp:CreateDate/i);
    const dir = join(process.cwd(), 'public/assets/photos/adventures');
    const { readdirSync: ls } = await import('node:fs');
    const files = ls(dir).filter((f) => f.endsWith('.webp'));
    expect(files).toHaveLength(47);
    // The postcards' 800px copies carry the same statement, and nothing else either.
    const copies = ls(join(dir, '800')).map((f) => `800/${f}`);
    expect(copies.length).toBeGreaterThan(0);
    for (const f of [...files, ...copies]) {
      const meta = await sharp(join(dir, f)).metadata();
      expect(meta.exif, f).toBeUndefined();
      // `npm run photos:stamp` writes it; nothing else (camera, date, place) may ride along.
      expect(meta.xmp?.toString('utf8'), f).toBe(expected);
      expect(Math.max(meta.width ?? 0, meta.height ?? 0), f).toBeLessThanOrEqual(1600);
    }
  });
});
