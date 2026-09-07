import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { GalleryPage } from '@/capabilities/media';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { DEFAULT_COLLECTIONS } from '@/domain/media/collections';
import { recipes } from '../../_recipes';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COPY = { empty: 'Nothing here yet.', allAlbums: 'All albums', showMore: 'Show more' };

/**
 * The album's own title, not its slug de-hyphenated. `collection.replace(/-/g, ' ')` put
 * "engagement | Sara + Tyler" in the tab and the share card while the h1 read "Engagement", and it
 * generalises worse than that: "full ceremony", "first dances", "raw / archive" all lose their
 * capitals. `DEFAULT_COLLECTIONS` already holds the authored title. A slug with no default falls
 * back to the section name rather than to a guess, and an album the caller may not see is not
 * revealed here either — this runs before the ACL check, so it must never name a private album.
 */
export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params;
  const known = SLUG.test(collection) ? DEFAULT_COLLECTIONS.find((c) => c.slug === collection && c.visibility === 'public') : undefined;
  return { title: known ? known.title : 'Photos & Video' };
}

/** One album: lazy responsive grid, lightbox, "show more" pagination by signed cursor. */
export default async function CollectionPage({ params, searchParams }: { params: Promise<{ collection: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { collection } = await params;
  const { cursor } = await searchParams;
  if (!SLUG.test(collection)) notFound();
  const principal = await currentPrincipal();
  const gallery = await invokeForRequest<GalleryPage>('list_gallery', { collection, ...(cursor && /^[A-Za-z0-9_-]{1,256}$/.test(cursor) ? { cursor } : {}) }, principal);
  // A collection the caller may not see is indistinguishable from one that does not exist: no
  // enumeration of admin-only albums, which is the same answer `list_gallery` gives.
  if (!gallery.ok) notFound();
  const { collection: album, items, nextCursor } = gallery.data;
  return (
    <recipes.PhotoAlbumPage
      slug={collection}
      title={album?.title ?? 'Album'}
      description={album?.description ?? null}
      items={items}
      nextCursor={nextCursor ?? null}
      copy={COPY}
    />
  );
}
