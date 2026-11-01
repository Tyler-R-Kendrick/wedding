import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadContentSeed } from '@/content';
import { getDb } from '@/db/client';
import { timelineMoments } from '@/db/schema';
import { seedTimeline } from '@/db/seed/content';

/**
 * The Paired import rewrites timeline.json: it re-dates (reorders) the line, adds stops and drops
 * stops the export no longer has. db:seed must follow the file by slug, never by position, and must
 * never touch a station someone edited or typed in /admin/content.
 */
describe('seeding the timeline', () => {
  it('follows the file by slug through a reorder, removes dropped seed rows, and leaves edited rows alone', async () => {
    const db = await getDb();
    const seed = loadContentSeed();
    const now = new Date('2026-09-23T00:00:00Z');
    const sampleTimeline = [
      { slug: 'starved-rock', chapter: 'love' as const, order: 1, title: 'Starved Rock', note: 'We said “I love you”.', media: [], sourceKey: 'brief' as const, sourceType: 'authored' as const, verifiedAt: '2026-09-04T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING' as const, editedBy: 'seed:brief-2026-09-04', visibility: 'public' as const, placeholder: false },
      { slug: 'madison-waterfront', chapter: 'relationship' as const, order: 2, title: 'Madison waterfront', note: 'TODO(Tyler & Sara): one line.', media: [], sourceKey: 'brief' as const, sourceType: 'authored' as const, verifiedAt: '2026-09-04T00:00:00.000Z', trustClass: 'TRUSTED_WEDDING' as const, editedBy: 'seed:brief-2026-09-04', visibility: 'public' as const, placeholder: true },
    ];
    await seedTimeline(db, { ...seed, timeline: sampleTimeline }, now);

    await db.update(timelineMoments).set({ note: 'Edited by hand.', contentVersion: 2 }).where(eq(timelineMoments.slug, 'madison-waterfront'));
    const [template] = await db.select().from(timelineMoments).where(eq(timelineMoments.slug, 'starved-rock'));
    await db.insert(timelineMoments).values({ ...template!, id: 'admin-typed-1', slug: 'our-first-apartment', title: 'Our first apartment', editedBy: 'admin:someone', contentVersion: 1 });

    const reordered = sampleTimeline.filter((t) => t.slug === 'madison-waterfront').map((t, i) => ({ ...t, order: i + 1 }));
    await seedTimeline(db, { ...seed, timeline: reordered }, now);

    const rows = await db.select().from(timelineMoments).orderBy(asc(timelineMoments.order));
    const slugs = rows.map((r) => r.slug);
    expect(slugs).not.toContain('starved-rock');
    expect(rows.find((r) => r.slug === 'madison-waterfront')?.note).toBe('Edited by hand.');
    expect(slugs).toContain('our-first-apartment');
  });
});
