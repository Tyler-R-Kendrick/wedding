import Link from 'next/link';
import { MediaEmpty, MediaPage, MediaSection } from '@/components/media/MediaShell';
import { ROUTES } from '@/domain/routes';
import type { PhotosProps } from '@/themes/content-types';

/**
 * Fallback for a theme that supplies no `photos` recipe — swarm H's original page, unchanged.
 * Both shipped designs supply one, so this is the safety net the seam has always had, not the
 * page anyone sees.
 */
export function PhotosPage({ albums, canUpload, copy }: Omit<PhotosProps, 'frame'>) {
  return (
    <MediaPage
      eyebrow={copy.eyebrow}
      title={copy.title}
      lede={copy.lede}
      actions={
        canUpload ? (
          <>
            <Link className="media-button" href="/media/upload">
              Add your photos
            </Link>
            <Link className="media-button media-button--secondary" href="/media/mine">
              My uploads
            </Link>
          </>
        ) : undefined
      }
    >
      <MediaSection id="albums">
        {albums.length === 0 ? (
          <MediaEmpty>{copy.empty}</MediaEmpty>
        ) : (
          <ul className="media-albums">
            {albums.map((c) => (
              <li key={c.slug} className="media-album">
                <Link href={`${ROUTES.photos}/${c.slug}`}>{c.title}</Link>
                {c.description ? <span className="media-lede">{c.description}</span> : null}
                <span className="media-album__count">{c.itemCount === 0 ? 'Nothing here yet' : c.itemCount === 1 ? '1 item' : `${c.itemCount} items`}</span>
              </li>
            ))}
          </ul>
        )}
      </MediaSection>
    </MediaPage>
  );
}
