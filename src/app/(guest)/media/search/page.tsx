import type { Metadata } from 'next';
import Link from 'next/link';
import type { CollectionSummary } from '@/capabilities/media';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { MediaSearch } from '@/components/mediaai/MediaSearch';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search the photos', robots: { index: false, follow: false } };

/**
 * Search by meaning across the albums the visitor may see. Anonymous visitors search the public
 * albums; signed-in guests also search the guest albums. Nothing about faces happens here.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const principal = await currentPrincipal();
  const { q } = await searchParams;
  const gallery = await invokeForRequest<{ collections: CollectionSummary[] }>('list_gallery', {}, principal);
  const collections = gallery.ok ? gallery.data.collections : [];
  return (
    <MediaPage
      eyebrow="Photos & Video"
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
      {principal.kind === 'anonymous' ? (
        <MediaSection id="signin">
          <p className="media-lede">You are searching the public albums. Open the link from your invitation to search everything the couple shared with guests.</p>
        </MediaSection>
      ) : null}
    </MediaPage>
  );
}
