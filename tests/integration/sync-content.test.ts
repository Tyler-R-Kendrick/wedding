import { asc, eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadContentSeed, SOURCE_KEYS } from '@/content';
import { getDb } from '@/db/client';
import { adventureMemories, contentSources, events, knowledgeRecords } from '@/db/schema';
import { syncContent } from '@/db/seed/sync-content';

/**
 * What a production deploy does to content (scripts/deploy/migrate-on-deploy.mjs → db:sync-content).
 * Production was seeded once, by hand, long before the adventure photos existed, and deploys only
 * migrated, so the photos' adventures and their "photos" source never reached it. The sync has to
 * bring both in, and must never undo an edit made in /admin/content or write anything but content.
 */
describe('syncing content on deploy', () => {
  it('brings in content the database lacks, keeps admin edits, and writes nothing but content', async () => {
    const db = await getDb();
    const seed = loadContentSeed();
    const photoSlugs = seed.adventures.filter((a) => a.sourceKey === 'photos').map((a) => a.slug);
    expect(photoSlugs.length).toBeGreaterThan(40);

    // Production as it was: the brief's adventures only, no "photos" source, and one adventure an
    // admin has since edited by hand.
    await db.delete(adventureMemories).where(inArray(adventureMemories.slug, photoSlugs));
    await db.delete(contentSources).where(eq(contentSources.id, SOURCE_KEYS.photos));
    await db.update(adventureMemories).set({ title: 'Starved Rock, as we tell it', contentVersion: 2 }).where(eq(adventureMemories.slug, 'starved-rock'));
    const eventsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(events);

    await syncContent(db, new Date('2026-09-24T00:00:00Z'));

    const slugs = (await db.select({ slug: adventureMemories.slug }).from(adventureMemories)).map((r) => r.slug);
    for (const s of photoSlugs) expect(slugs, s).toContain(s);
    expect(await db.select().from(contentSources).where(eq(contentSources.id, SOURCE_KEYS.photos))).toHaveLength(1);
    const [starved] = await db.select().from(adventureMemories).where(eq(adventureMemories.slug, 'starved-rock'));
    expect(starved?.title).toBe('Starved Rock, as we tell it');
    // The AI corpus is re-projected from the synced rows.
    const corpus = await db.select({ title: knowledgeRecords.title }).from(knowledgeRecords);
    expect(corpus.map((r) => r.title)).toContain('Noma');
    // Events are seeded once, by hand; the sync never touches them.
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(events)).toEqual(eventsBefore);

    // A second deploy with nothing new changes nothing.
    const all = () => db.select().from(adventureMemories).orderBy(asc(adventureMemories.slug));
    const before = await all();
    await syncContent(db, new Date('2026-09-24T00:00:00Z'));
    expect(await all()).toEqual(before);
  });

  it('rolls back whole when it cannot finish, leaving the database as it was', async () => {
    const db = await getDb();
    const photoSlug = loadContentSeed().adventures.find((a) => a.sourceKey === 'photos')!.slug;
    await db.delete(adventureMemories).where(eq(adventureMemories.slug, photoSlug));
    // A row typed by hand has taken a slug the sync needs for a different id: the upsert clashes.
    const [template] = await db.select().from(adventureMemories).where(eq(adventureMemories.slug, 'starved-rock'));
    await db.insert(adventureMemories).values({ ...template!, id: 'typed-by-hand' as never, slug: photoSlug, contentVersion: 1 });
    await db.update(contentSources).set({ title: 'before the sync' }).where(eq(contentSources.id, SOURCE_KEYS.photos));

    await expect(syncContent(db)).rejects.toThrow();

    // Nothing the sync wrote before the clash survived, including the sources it writes first.
    const [source] = await db.select().from(contentSources).where(eq(contentSources.id, SOURCE_KEYS.photos));
    expect(source?.title).toBe('before the sync');
    await db.delete(adventureMemories).where(eq(adventureMemories.id, 'typed-by-hand' as never));
  });
});
