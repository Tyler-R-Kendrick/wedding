import { Placeholder } from '@/components/provenance/Placeholder';
import Link from 'next/link';

/** Shown when the caller is not a signed-in guest. Never reveals whether an invitation exists. */
export function GuestsOnly({ what }: { what: string }) {
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
        <Link className="btn btn--primary" href="/sign-in">
          Find your invitation
        </Link>
      </p>
      <p className="card__meta">Lost the link? <Placeholder inline>how to reach them</Placeholder></p>
    </main>
  );
}

export function FriendlyFailure({ what }: { what: string }) {
  return (
    <main id="main" className="page">
      <h1 className="page__title">{what} is taking a moment</h1>
      <p className="page__lede">Something went wrong on our side. Please try again in a minute.</p>
      <p>If it keeps happening, reach Sara and Tyler directly. <Placeholder inline>their contact details</Placeholder></p>
    </main>
  );
}
