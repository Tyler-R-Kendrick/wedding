import { Placeholder } from '@/components/provenance/Placeholder';
import Link from 'next/link';

/** Shown when the caller is not a signed-in guest. Never reveals whether an invitation exists. */
export function GuestsOnly({ what }: { what: string }) {
  return (
    <main id="main" className="page">
      <h1 className="page__title">{what} is for invited guests</h1>
      <p className="page__lede">Open the link from your invitation to find your household, then confirm with the code we e-mail you. No account, no password.</p>
      <p>
        <Link className="btn btn--primary" href="/claim">
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
