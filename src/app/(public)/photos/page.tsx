import type { Metadata } from 'next';
import Link from 'next/link';
import type { GalleryPage } from '@/capabilities/media';
import { MediaEmpty, MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { hasEntitlement } from '@/contracts/principal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photos & Video' };

/** Album index: what the caller may see (public albums for everyone, guest albums and chapters for signed-in guests). */
export default async function PhotosPage() {
  const principal = await currentPrincipal();
  const gallery = await invokeForRequest<GalleryPage>('list_gallery', {}, principal);
  const canUpload = principal.kind !== 'anonymous' && hasEntitlement(principal, 'upload_media');
  const collections = gallery.ok ? gallery.data.collections : [];
  return (
    <MediaPage
      eyebrow="Sara + Tyler"
      title="Photos & Video"
      lede="Engagement photos now; after the wedding, the professional chapters and the moments our guests captured."
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
        {collections.length === 0 ? (
          <MediaEmpty>Nothing to show yet.</MediaEmpty>
        ) : (
          <ul className="media-albums">
            {collections.map((c) => (
              <li key={c.slug} className="media-album">
                <Link href={`/photos/${c.slug}`}>{c.title}</Link>
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
