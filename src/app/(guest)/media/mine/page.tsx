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
      title="My uploads"
      lede="Everything you have added, and where each one is. Only you and the couple can see items that are still being reviewed."
      // Gated on a session. Rendered unconditionally, "Add more" was the only link on the page when
      // signed out, and it led to /media/upload, which answers "Please sign in first" — a dead end
      // whose one exit was the thing that had just failed.
      actions={
        result ? (
          <Link className="media-button" href="/media/upload">
            Add more
          </Link>
        ) : undefined
      }
    >
      {!result ? (
        /* The same shape /media/upload gives this state: a real heading, so the page has an outline
           (it was ["H1: My uploads"] and nothing else) and a way back to the site. */
        <MediaSection title="Please sign in first" id="sign-in">
          <p className="media-lede">Open the link from your invitation to sign in, then come back here to see everything you have added.</p>
          <p>
            <Link className="media-button" href="/">
              Go to the site
            </Link>
          </p>
        </MediaSection>
      ) : (
        <MediaSection id="list">{!result.ok ? <p className="media-lede">{result.error.message}</p> : <UploadList items={result.data.items} uploadHref="/media/upload" />}</MediaSection>
      )}
    </MediaPage>
  );
}
