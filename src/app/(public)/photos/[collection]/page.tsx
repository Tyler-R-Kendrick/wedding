import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { GalleryPage } from '@/capabilities/media';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { recipes } from '../../_recipes';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COPY = { eyebrow: 'Photos & Video', empty: 'Nothing here yet.', allAlbums: 'All albums', showMore: 'Show more' };

export async function generateMetadata({ params }: { params: Promise<{ collection: string }> }): Promise<Metadata> {
  const { collection } = await params;
  return { title: SLUG.test(collection) ? collection.replace(/-/g, ' ') : 'Photos & Video' };
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
