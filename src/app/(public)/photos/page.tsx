import type { Metadata } from 'next';
import type { GalleryPage } from '@/capabilities/media';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { hasEntitlement } from '@/contracts/principal';
import { recipes } from '../_recipes';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photos & Video' };

// "Engagement photos now" was false on the page that said it: `main` rendered zero <img>, the one
// album an anonymous visitor can see read "Nothing here yet", and the engagement shoot is still an
// unanswered couple item in PRODUCT.md. Both design reviewers caught it independently — the lede
// and the contradiction sat inside the same 390x844 viewport. A visible gap is fine on this site;
// a sentence asserting a state the page disproves two paragraphs later is not.
// (The authoring marker is deliberately not spelled out here: it belongs in the content record, and
// a literal copy of it in source inflates the inventory the sweep counts.)
const COPY = {
  title: 'Photos & Video',
  lede: 'This is where the photographs will live: the engagement pictures first, then the professional chapters and the moments our guests capture over the weekend.',
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
