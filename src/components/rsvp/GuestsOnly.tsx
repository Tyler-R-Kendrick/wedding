import Link from 'next/link';
import { Placeholder } from '@/components/provenance/Placeholder';

/**
 * The signed-out and the signed-in-without-access cases are different sentences.
 *
 * They used to be the same one. A guest whose invitation was revoked AFTER they claimed it — and a
 * delegate, and any guest during a flag-off window — kept a valid session and an empty entitlement
 * set (`src/policy/derive.ts`), so every guest page told them to "open the link from your invitation
 * … then confirm with the code we e-mail you". They had. The code worked. The one true sentence —
 * your invitation is no longer active, please ask Sara and Tyler — was never said, and the only
 * button offered was `/sign-in`, which succeeds and lands back on the page that just refused them.
 * That loop has no exit; a reviewer walked it.
 */
export function GuestsOnly({ what, signedIn = false, returnTo }: { what: string; signedIn?: boolean; returnTo?: string }) {
  // Carrying the path through sign-in is what `next` is for: `/sign-in` renders the hidden field and
  // `verifyCode` honours it, but this page linked to a bare `/sign-in`, so a guest who tapped RSVP
  // in an email, signed in, and landed on Your Weekend had to find their way back alone.
  const href = returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : '/sign-in';
  if (signedIn) {
    return (
      <main id="main" className="page">
        <h1 className="page__title">{what} is not on your invitation</h1>
        <p className="page__lede">
          You are signed in, so nothing is wrong with your link or your code. This part of the site is not open to you right now — most often because your invitation was replaced or cancelled after you
          claimed it.
        </p>
        <p>Sara and Tyler can put it right; nothing here will fix it by itself, so please do not keep signing in.</p>
        <p className="card__meta">
          To reach them: <Placeholder inline>how to reach them</Placeholder>
        </p>
      </main>
    );
  }
  return (
    <main id="main" className="page">
      <h1 className="page__title">{what} is for invited guests</h1>
      <p className="page__lede">Open the link from your invitation to find your household, then confirm with the code we e-mail you. No account, no password.</p>
      {/* `/claim` has no page — only `/claim/verify`, `/claim/welcome` and `/claim/passkey`, which
          are steps you reach with a token. So the primary action on the signed-out RSVP and Your
          Weekend pages, the one an invited guest most needs, was a 404. `/sign-in` is what a guest
          without their link actually wants: "Sign in with your email". Second dead internal link
          found this level (after `/photos` in the nav); `tests/e2e/links.spec.ts` now walks them. */}
      <p>
        <Link className="btn btn--primary" href={href}>
          Find your invitation
        </Link>
      </p>
      <p className="card__meta">
        Lost the link? <Placeholder inline>how to reach them</Placeholder>
      </p>
    </main>
  );
}

export function FriendlyFailure({ what }: { what: string }) {
  return (
    <main id="main" className="page">
      <h1 className="page__title">{what} is taking a moment</h1>
      <p className="page__lede">Something went wrong on our side. Please try again in a minute.</p>
      <p>
        If it keeps happening, reach Sara and Tyler directly. <Placeholder inline>their contact details</Placeholder>
      </p>
    </main>
  );
}
