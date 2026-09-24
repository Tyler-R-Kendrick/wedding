import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CollectionSummary } from '@/capabilities/media';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { MediaSearch } from '@/components/mediaai/MediaSearch';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search the photos', robots: { index: false, follow: false } };

/**
 * Search by meaning across the albums the signed-in visitor may see. Like the albums themselves it
 * sits behind the account menu: an anonymous visitor signs in first and comes back with their query.
 * Nothing about faces happens here.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const principal = await currentPrincipal();
  const { q } = await searchParams;
  if (principal.kind === 'anonymous') {
    const back = typeof q === 'string' && q ? `/media/search?q=${encodeURIComponent(q.slice(0, 200))}` : '/media/search';
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  const gallery = await invokeForRequest<{ collections: CollectionSummary[] }>('list_gallery', {}, principal);
  const collections = gallery.ok ? gallery.data.collections : [];
  return (
    <MediaPage

      title="Search the photos"
      lede="Describe what you remember — “first dance”, “flowers on the table”, “outside at dusk” — and we will look through the descriptions people wrote and the ones we suggested for them."
      actions={
        <Link className="media-button media-button--secondary" href="/photos">
          Browse the albums
        </Link>
      }
    >
      <MediaSection id="search">
        <MediaSearch collections={collections} initialQuery={typeof q === 'string' ? q.slice(0, 200) : ''} />
      </MediaSection>
    </MediaPage>
  );
}
