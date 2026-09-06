import type { Metadata } from 'next';
import { invoke } from '@/capabilities';
import { getMyRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
import { Placeholder } from '@/components/provenance/Placeholder';
import { RsvpForm } from '@/components/rsvp/RsvpForm';
import { formatDeadline } from '@/domain/events/format';
import { uiContext } from '../_shared/principal';
import { rsvpAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVP', robots: { index: false, follow: false } };

/** Route only: resolve the principal, call the capability, render the recipe. No business logic here. */
export default async function RsvpPage() {
  const { ctx, principal } = await uiContext();
  if (principal.kind !== 'guest') return <GuestsOnly what="RSVP" />;
  const result = await invoke(getMyRsvp, ctx, {});
  if (!result.ok) {
    if (result.error.code === 'unauthenticated' || result.error.code === 'forbidden') return <GuestsOnly what="RSVP" />;
    return <FriendlyFailure what="RSVP" />;
  }
  const data = result.value.data;
  const self = data.guests.find((g) => g.isSelf);
  return (
    <main id="main" className="page">
      {/* A closed window must not be asked a question. The same defect as the deadline copy below,
          one element up: "Ada, will you join us?" sitting above "RSVPs are closed" invites an answer
          the page will not take. Personalisation is kept either way. */}
      <h1 className="page__title">
        {data.window.open
          ? data.guests.length > 1
            ? `${data.household.name}, will you join us?`
            : `${self?.firstName ?? 'Hello'}, will you join us?`
          : data.guests.length > 1
            ? `${data.household.name}, your RSVP`
            : `${self?.firstName ?? 'Your'} RSVP`}
      </h1>
      <p className="page__lede">Saturday, July 17, 2027, at the Chicago Athletic Association Hotel.</p>
      {/* Branches the same way /your-weekend does, and on the same field. Branching on `deadlineAt`
          alone printed "…while RSVPs are open" directly above the form's "RSVPs are closed" notice —
          and a closed window with no deadline is the seeded default (events seed `mode: 'auto'`,
          lifecycle TEASER), so the contradiction was what a guest saw first, not an edge case. */}
      {data.window.deadlineAt ? (
        <p className="card__meta">Please answer by {formatDeadline(data.window.deadlineAt)}.</p>
      ) : data.window.open ? (
        <p className="card__meta">
          <Placeholder inline>the date answers are needed by</Placeholder>
        </p>
      ) : null}
      <RsvpForm data={data} action={rsvpAction} idempotencyKey={newId()} />
    </main>
  );
}
