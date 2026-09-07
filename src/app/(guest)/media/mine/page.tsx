import type { Metadata } from 'next';
import Link from 'next/link';
import type { MyUploadItem } from '@/capabilities/media';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { UploadList } from '@/components/media/UploadList';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'My uploads', robots: { index: false, follow: false } };

export default async function MyUploadsPage() {
  const principal = await currentPrincipal();
  const result = principal.kind === 'guest' ? await invokeForRequest<{ items: MyUploadItem[] }>('list_my_uploads', { limit: 100 }, principal) : null;
  return (
    <MediaPage
      eyebrow="Photos & Video"
      title="My uploads"
      lede="Everything you have added, and where each one is. Only you and the couple can see items that are still being reviewed."
      actions={
        <Link className="media-button" href="/media/upload">
          Add more
        </Link>
      }
    >
      <MediaSection id="list">
        {!result ? (
          <p className="media-lede">Open the link from your invitation to sign in, then come back here.</p>
        ) : !result.ok ? (
          <p className="media-lede">{result.error.message}</p>
        ) : (
          <UploadList items={result.data.items} uploadHref="/media/upload" />
        )}
      </MediaSection>
    </MediaPage>
  );
}
