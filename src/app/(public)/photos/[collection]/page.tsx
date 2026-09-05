import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { GalleryPage } from '@/capabilities/media';
import { GalleryGrid } from '@/components/media/GalleryGrid';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

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
  if (!gallery.ok) {
    if (gallery.error.code === 'not_found') notFound();
    return (
      <MediaPage eyebrow="Photos & Video" title="Album">
        <p className="media-lede">{gallery.error.message}</p>
      </MediaPage>
    );
  }
  const { collection: album, items, nextCursor } = gallery.data;
  return (
    <MediaPage
      eyebrow="Photos & Video"
      title={album?.title ?? 'Album'}
      lede={album?.description ?? undefined}
      actions={
        <Link className="media-button media-button--secondary" href="/photos">
          All albums
        </Link>
      }
    >
      <MediaSection id="grid">
        <GalleryGrid items={items} emptyMessage="Nothing here yet." />
        {nextCursor ? (
          <div className="media-pager">
            <Link className="media-button media-button--secondary" href={`/photos/${collection}?cursor=${encodeURIComponent(nextCursor)}`} rel="next">
              Show more
            </Link>
          </div>
        ) : null}
      </MediaSection>
    </MediaPage>
  );
}
