import type { Metadata } from 'next';
import type { GalleryPage } from '@/capabilities/media';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { hasEntitlement } from '@/contracts/principal';
import { recipes } from '../_recipes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photos & Video' };

const COPY = {
  eyebrow: 'Sara + Tyler',
  title: 'Photos & Video',
  lede: 'Engagement photos now; after the wedding, the professional chapters and the moments our guests captured.',
  empty: 'Nothing to show yet.',
};

/**
 * Album index: what the caller may see (public albums for everyone, guest albums and chapters for
 * signed-in guests).
 *
 * Rendered through the recipe seam, so the page arrives inside the active design's Shell. Bare, it
 * had no nav, no design switcher, an h1 in the text face at one fixed size in both designs, and —
 * with JavaScript off — Times New Roman, because nothing above it carried `[data-theme]`.
 */
export default async function PhotosPage() {
  const principal = await currentPrincipal();
  const gallery = await invokeForRequest<GalleryPage>('list_gallery', {}, principal);
  return (
    <recipes.PhotosPage
      albums={gallery.ok ? gallery.data.collections : []}
      canUpload={principal.kind !== 'anonymous' && hasEntitlement(principal, 'upload_media')}
      copy={COPY}
    />
  );
}
