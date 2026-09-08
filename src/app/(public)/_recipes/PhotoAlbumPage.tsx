import Link from 'next/link';
import { GalleryGrid } from '@/components/media/GalleryGrid';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { ROUTES } from '@/domain/routes';
import type { PhotoAlbumProps } from '@/themes/content-types';

/** Fallback for a theme with no `photoAlbum` recipe — swarm H's original page, unchanged. */
export function PhotoAlbumPage({ slug, title, description, items, nextCursor, copy }: Omit<PhotoAlbumProps, 'frame'>) {
  // A fallback recipe renders WITHOUT a theme Shell, so it carries the document landmark itself;
  // `MediaPage` stopped emitting one when the guest tree moved onto the per-design Shell.
  return (
    <main id="main">
      <MediaPage
      title={title}
      {...(description ? { lede: description } : {})}
      actions={
        <Link className="media-button media-button--secondary" href={ROUTES.photos}>
          {copy.allAlbums}
        </Link>
      }
    >
      <MediaSection id="grid">
        <GalleryGrid items={items} emptyMessage={copy.empty} />
        {nextCursor ? (
          <div className="media-pager">
            <Link className="media-button media-button--secondary" href={`${ROUTES.photos}/${slug}?cursor=${encodeURIComponent(nextCursor)}`} rel="next">
              {copy.showMore}
            </Link>
          </div>
        ) : null}
      </MediaSection>
      </MediaPage>
    </main>
  );
}
