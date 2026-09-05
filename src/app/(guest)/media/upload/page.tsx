import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaEmpty, MediaPage, MediaSection } from '@/components/media/MediaShell';
import { UploadForm } from '@/components/media/UploadForm';
import { currentPrincipal } from '@/components/media/server';
import { hasEntitlement } from '@/contracts/principal';
import { getFlags } from '@/lib/flags';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Add your photos', robots: { index: false, follow: false } };

/**
 * The QR upload page. Guests reach it from the printed code at the wedding; it needs the guest's
 * session (the QR itself never grants access). Mobile first: one big picker, per-file progress,
 * retry and resume, and honest states.
 */
export default async function UploadPage() {
  const principal = await currentPrincipal();
  const flags = getFlags();
  const allowed = principal.kind !== 'anonymous' && hasEntitlement(principal, 'upload_media');
  return (
    <MediaPage eyebrow="Photos & Video" title="Add your photos and videos" lede="Pick a few from your camera roll and we will take it from there. Sara and Tyler look at everything before it is shared with other guests.">
      {!flags.GUEST_UPLOADS ? (
        <MediaEmpty>Uploads are not open right now. Please check back after the wedding.</MediaEmpty>
      ) : !allowed ? (
        <MediaSection title="Please sign in first" id="sign-in">
          <p className="media-lede">Open the link from your invitation to sign in, then come back here to add photos. Nothing on this page is shared with other guests until it has been reviewed.</p>
          <p>
            <Link className="media-button" href="/">
              Go to the site
            </Link>
          </p>
        </MediaSection>
      ) : (
        <>
          <MediaSection id="upload">
            <UploadForm myUploadsHref="/media/mine" />
          </MediaSection>
          <MediaSection title="What happens next" id="next">
            <p className="media-lede">Each file is checked and prepared in web sizes with the location data removed. You can see the state of everything you have added under &ldquo;My uploads&rdquo;, and remove anything of yours at any time.</p>
            <p>
              <Link className="media-link" href="/media/mine">
                My uploads
              </Link>
            </p>
          </MediaSection>
        </>
      )}
    </MediaPage>
  );
}
