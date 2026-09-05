import type { Metadata } from 'next';
import Link from 'next/link';
import type { MyUploadItem } from '@/capabilities/media';
import type { MyBiometricConsent } from '@/capabilities/biometrics';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { FaceMatching } from '@/components/mediaai/FaceMatching';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Photos of me', robots: { index: false, follow: false } };

/**
 * The guest's own privacy surface for face matching (ADR-0006). With the feature off it says so
 * plainly and shows no consent copy at all; withdrawal and deletion stay available either way,
 * because those obligations outlive the feature.
 */
export default async function PhotosOfMePage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'guest') {
    return (
      <MediaPage eyebrow="Photos & Video" title="Photos of me" lede="Open the link from your invitation to sign in, then come back here.">
        <MediaSection id="signin">
          <p className="media-lede">
            You can still <Link className="media-link" href="/media/search">search the photos</Link> without signing in.
          </p>
        </MediaSection>
      </MediaPage>
    );
  }
  const [consent, uploads] = await Promise.all([
    invokeForRequest<MyBiometricConsent>('get_my_biometric_consent', {}, principal),
    invokeForRequest<{ items: MyUploadItem[] }>('list_my_uploads', { limit: 40 }, principal),
  ]);
  return (
    <MediaPage
      eyebrow="Photos & Video"
      title="Photos of me"
      lede="Two ways to find yourself in the archive: search for what you remember, or — only if you ask us to — let us compare your own reference photos against the ones you pick."
      actions={
        <Link className="media-button media-button--secondary" href="/media/search">
          Search the photos
        </Link>
      }
    >
      <MediaSection id="search" title="Search, no faces involved">
        <p className="media-lede">
          The <Link className="media-link" href="/media/search">search page</Link> looks through captions and album information. It never uses face recognition and needs no permission from you.
        </p>
      </MediaSection>
      <MediaSection id="faces" title="Face matching">
        {consent.ok ? (
          <FaceMatching initial={consent.data} candidates={uploads.ok ? uploads.data.items : []} />
        ) : (
          <p className="media-lede">{consent.error.message}</p>
        )}
      </MediaSection>
    </MediaPage>
  );
}
