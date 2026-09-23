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
    await seedTimeline(db, seed, now);

    // An admin edits one seeded station (contentVersion > 1) and types a brand-new one.
    await db.update(timelineMoments).set({ note: 'Edited by hand.', contentVersion: 2 }).where(eq(timelineMoments.slug, 'richardson-farm'));
    const [template] = await db.select().from(timelineMoments).where(eq(timelineMoments.slug, 'food-tastings'));
    await db.insert(timelineMoments).values({ ...template!, id: 'admin-typed-1', slug: 'our-first-apartment', title: 'Our first apartment', editedBy: 'admin:someone', contentVersion: 1 });

    // The next import reverses the line and drops two stops, one of them the edited one.
    const reordered = [...seed.timeline].reverse().filter((t) => !['madison-waterfront', 'richardson-farm'].includes(t.slug)).map((t, i) => ({ ...t, order: i + 1 }));
    await seedTimeline(db, { ...seed, timeline: reordered }, now);

    const rows = await db.select().from(timelineMoments).orderBy(asc(timelineMoments.order));
    const slugs = rows.map((r) => r.slug);
    // Every seeded stop now carries its new order under its own slug.
    for (const t of reordered) expect(rows.find((r) => r.slug === t.slug)?.order, t.slug).toBe(t.order);
    // A dropped seed row is gone; a dropped row someone edited stays; a typed row stays.
    expect(slugs).not.toContain('madison-waterfront');
    expect(rows.find((r) => r.slug === 'richardson-farm')?.note).toBe('Edited by hand.');
    expect(slugs).toContain('our-first-apartment');
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
