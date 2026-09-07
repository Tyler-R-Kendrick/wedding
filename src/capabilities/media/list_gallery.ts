import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { canViewCollection, canViewPublishedAsset, countPublishedByCollection, ensureDefaultCollections, getCollectionBySlug, listCollections, listPublishedAssets } from '@/domain/media';
import { collectionSummary, collectionSummarySchema, CURSOR, GALLERY_PAGE_DEFAULT, GALLERY_PAGE_MAX, galleryItemSchema, mediaServices, SLUG, toGalleryItems } from './_shared';

const input = z.object({ collection: SLUG.optional(), cursor: CURSOR, limit: z.number().int().min(1).max(GALLERY_PAGE_MAX).optional() }).optional();
const output = z.object({
  collections: z.array(collectionSummarySchema),
  collection: collectionSummarySchema.nullable(),
  items: z.array(galleryItemSchema),
  nextCursor: z.string().optional(),
});
export type GalleryPage = z.infer<typeof output>;

export const listGallery = defineCapability<z.infer<typeof input>, GalleryPage>({
  name: 'list_gallery',
  title: 'Photos & Video',
  description:
    'Lists the albums the caller may see (engagement photos, guest uploads, professional chapters such as Full Ceremony or Toasts) ' +
    'and, for one album, its published items with short-lived thumbnail links. Anonymous visitors see public albums only; ' +
    'signed-in guests also see guest albums. Never returns anything awaiting review.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    await ensureDefaultCollections(services.db, ctx.now);
    const [all, counts] = await Promise.all([listCollections(services.db), countPublishedByCollection(services.db)]);
    const visible = all.filter((c) => canViewCollection(ctx.principal, c));
    const collections = visible.map((c) => collectionSummary(c, counts.get(c.id) ?? 0));
    if (!i?.collection) return ok({ data: { collections, collection: null, items: [] }, sources: [] });
    const collection = await getCollectionBySlug(services.db, i.collection);
    // Hidden and missing look the same: no enumeration of admin-only albums.
    if (!collection || !canViewCollection(ctx.principal, collection)) return err(new CapabilityError('not_found', 'That album is not available.'));
    const page = await listPublishedAssets(services.db, { collectionId: collection.id, cursor: i.cursor, limit: i.limit ?? GALLERY_PAGE_DEFAULT });
    /*
     * The asset's OWN visibility, not just its collection's. `media_assets.visibility` is nullable
     * and documented as "Overrides the collection's visibility when set"; `effectiveVisibility` and
     * `canViewPublishedAsset` implement exactly that, and this listing was the one read path that
     * never asked. `listPublishedAssets` filters on collection + published + not-deleted +
     * not-duplicate only, so a `household` or `private` asset sitting in a public album would have
     * been listed to anonymous visitors — and this capability is exposed to the AI concierge and
     * WebMCP as well as the page.
     *
     * Latent today: no capability writes the column, so it is always null and the fallback is the
     * collection's. That is precisely why it needed closing now — the first feature to set it
     * (media AI at level 11, admin ops at 14) would have opened the hole silently.
     *
     * Filtering after the query can under-fill a page; that is correct-but-short rather than wrong,
     * and clients follow `nextCursor`. Pushing the predicate into SQL belongs with whichever level
     * first writes the column and can test it against real rows.
     */
    const visibleItems = page.items.filter((a) => canViewPublishedAsset(ctx.principal, a, collection));
    const items = await toGalleryItems(services, visibleItems);
    return ok({ data: { collections, collection: collectionSummary(collection, counts.get(collection.id) ?? 0), items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }, sources: [] });
  },
});
