import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ContentSeed } from '@/content';
import adventureSlugRedirects from '@/content/adventure-slug-redirects.json';
import type { Db } from '../client';
import { adventureMemories, recommendations } from '../schema';
import { seedId } from './sources';

/** Slugs removed when same-day adventures were merged; next.config redirects these URLs. */
export const RETIRED_ADVENTURE_SLUGS = adventureSlugRedirects.map((r) => r.source.replace(/^\/our-adventures\//, ''));

/** Rows the repo seed or the photo import wrote — safe to reconcile or retire on deploy sync. */
export function isSeedManagedAdventure(editedBy: string): boolean {
  return editedBy.startsWith('seed:') || editedBy.startsWith('import:photo-exif');
}

/**
 * Drops merged-away photo fragments and other retired slugs. Only touches contentVersion 1 — admin
 * edits on a retired slug (unlikely) are preserved.
 */
export async function removeRetiredSeedAdventures(db: Db, retiredSlugs: readonly string[] = RETIRED_ADVENTURE_SLUGS): Promise<void> {
  if (!retiredSlugs.length) return;
  await db
    .delete(adventureMemories)
    .where(and(eq(adventureMemories.contentVersion, 1), inArray(adventureMemories.slug, [...retiredSlugs])));
}

/**
 * After a seed edit shifts positional ids, production still holds the old id under the same slug.
 * Re-key seed-managed rows by slug and point recommendations at the canonical id before upserting.
 */
export async function reconcileAdventureSeedKeys(
  db: Db,
  seed: ContentSeed,
  adventureIds: Map<string, string>,
  idBase: number,
): Promise<void> {
  for (const [i, a] of seed.adventures.entries()) {
    const canonicalId = seedId(idBase + i);
    adventureIds.set(a.slug, canonicalId);
    const [row] = await db.select().from(adventureMemories).where(eq(adventureMemories.slug, a.slug)).limit(1);
    if (!row || row.id === canonicalId || row.contentVersion !== 1 || !isSeedManagedAdventure(row.editedBy)) continue;
    await db.update(recommendations).set({ experienceId: canonicalId }).where(eq(recommendations.experienceId, row.id));
    await db.update(adventureMemories).set({ id: canonicalId }).where(eq(adventureMemories.id, row.id));
  }
}

/** Upserts adventures by slug so a re-keyed id never collides on the unique slug index. */
export async function upsertSeedAdventure(
  db: Db,
  values: typeof adventureMemories.$inferInsert,
): Promise<void> {
  const [existing] = await db.select().from(adventureMemories).where(eq(adventureMemories.slug, values.slug)).limit(1);
  if (existing) {
    if (existing.contentVersion > 1) return;
    if (!isSeedManagedAdventure(existing.editedBy)) {
      throw new Error(`content sync blocked: slug ${values.slug} is not seed-managed`);
    }
  }
  const { id: _id, createdAt: _createdAt, ...update } = values;
  await db
    .insert(adventureMemories)
    .values(values)
    .onConflictDoUpdate({ target: adventureMemories.slug, set: update, setWhere: sql`${adventureMemories.contentVersion} = 1` });
}
