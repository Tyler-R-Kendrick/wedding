import { asc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mediaCollections, type CollectionKind, type MediaCollectionRow, type MediaVisibility, type ProfessionalChapter } from '@/db/schema/media';
import { seedId } from '@/db/seed/sources';

export interface DefaultCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: CollectionKind;
  chapter: ProfessionalChapter | null;
  visibility: MediaVisibility;
  acceptsUploads: boolean;
  sortOrder: number;
}

/**
 * The fixed set of collections (brief §14 chapters). Ids are stable seed ids so the seed is
 * idempotent across boots and tests. Titles are ours; no facts about the photos are invented.
 */
export const DEFAULT_COLLECTIONS: readonly DefaultCollection[] = [
  { id: seedId(3001), slug: 'engagement', title: 'Engagement', description: 'Photos from before the wedding.', kind: 'engagement', chapter: null, visibility: 'public', acceptsUploads: false, sortOrder: 0 },
  { id: seedId(3002), slug: 'guest-uploads', title: 'From our guests', description: 'Photos and clips you took over the weekend.', kind: 'guest_uploads', chapter: null, visibility: 'guests', acceptsUploads: true, sortOrder: 10 },
  { id: seedId(3003), slug: 'full-ceremony', title: 'Full Ceremony', description: 'The ceremony, start to finish.', kind: 'professional', chapter: 'full_ceremony', visibility: 'guests', acceptsUploads: false, sortOrder: 20 },
  { id: seedId(3004), slug: 'toasts', title: 'Toasts', description: 'The toasts.', kind: 'professional', chapter: 'toasts', visibility: 'guests', acceptsUploads: false, sortOrder: 21 },
  { id: seedId(3005), slug: 'first-dances', title: 'First Dances', description: 'The first dances.', kind: 'professional', chapter: 'first_dances', visibility: 'guests', acceptsUploads: false, sortOrder: 22 },
  { id: seedId(3006), slug: 'guest-videos', title: 'Guest Videos', description: 'Clips our guests recorded.', kind: 'professional', chapter: 'guest_videos', visibility: 'guests', acceptsUploads: false, sortOrder: 23 },
  { id: seedId(3007), slug: 'professional-films', title: 'Professional Films', description: 'Edited films from Oakhouse Visuals.', kind: 'professional', chapter: 'professional_films', visibility: 'guests', acceptsUploads: false, sortOrder: 24 },
  { id: seedId(3008), slug: 'raw-archive', title: 'Raw / Archive', description: 'Raw footage and originals. Admin only.', kind: 'professional', chapter: 'raw_archive', visibility: 'private', acceptsUploads: false, sortOrder: 90 },
];

export const GUEST_UPLOADS_SLUG = 'guest-uploads';

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Idempotent: inserts missing default collections, never overwrites admin edits. */
export async function ensureDefaultCollections(db: Db, now: Date = new Date()): Promise<void> {
  for (const c of DEFAULT_COLLECTIONS) {
    await db
      .insert(mediaCollections)
      .values({ ...c, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: mediaCollections.id });
  }
}

export async function listCollections(db: Db): Promise<MediaCollectionRow[]> {
  return db.select().from(mediaCollections).orderBy(asc(mediaCollections.sortOrder), asc(mediaCollections.title));
}

export async function getCollectionBySlug(db: Db, slug: string): Promise<MediaCollectionRow | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  const rows = await db.select().from(mediaCollections).where(eq(mediaCollections.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getCollectionById(db: Db, id: string): Promise<MediaCollectionRow | null> {
  const rows = await db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).limit(1);
  return rows[0] ?? null;
}

export function chapterForSlug(slug: string): ProfessionalChapter | null {
  return DEFAULT_COLLECTIONS.find((c) => c.slug === slug)?.chapter ?? null;
}
