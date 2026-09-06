import { describe, expect, it } from 'vitest';
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

  it('memory places are private drafts with placeholder copy; only Starved Rock is public', () => {
    const publicOnes = seed.adventures.filter((a) => a.visibility === 'public').map((a) => a.slug);
    expect(publicOnes).toEqual(['starved-rock']);
    for (const a of seed.adventures) expect(a.placeholder, a.slug).toBe(true);
    const starved = seed.adventures.find((a) => a.slug === 'starved-rock')!;
    expect(starved.summary).toContain('I love you');
    // No invented trail, date, or wording: the memory body is a typed placeholder.
    expect(starved.memory.every(isPlaceholderText)).toBe(true);
    expect(starved.dateExact).toBeUndefined();
    expect(starved.dateApprox).toBeUndefined();
    expect(isPlaceholderText(starved.saraMemory)).toBe(true);
    expect(isPlaceholderText(starved.tylerMemory)).toBe(true);
  });

  it('every itinerary is a draft and the kit spaces carry "kit figure" capacity notes', () => {
    expect(seed.itineraries.every((i) => i.draft)).toBe(true);
    expect(seed.itineraries.map((i) => i.bucket).sort()).toEqual(['2-3-h', '45-min', 'architecture', 'food-drink', 'friday-afternoon', 'saturday-morning', 'stay-inside-caa', 'with-kids']);
    expect(seed.venueSpaces).toHaveLength(4);
    for (const s of seed.venueSpaces) expect(s.capacities.note.toLowerCase()).toContain('kit figure');
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
