import type { Metadata } from 'next';
import { invoke } from '@/capabilities';
import { getMyRsvp } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { FriendlyFailure, GuestsOnly } from '@/components/rsvp/GuestsOnly';
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
      <p className="page__eyebrow">RSVP</p>
      <h1 className="page__title">{data.guests.length > 1 ? `${data.household.name}, will you join us?` : `${self?.firstName ?? 'Hello'}, will you join us?`}</h1>
      <p className="page__lede">
        Saturday, July 17, 2027, at the Chicago Athletic Association Hotel.{' '}
        {data.window.deadlineAt ? `Please answer by ${formatDeadline(data.window.deadlineAt)}.` : 'Deadline TODO(Tyler & Sara).'}
      </p>
      <RsvpForm data={data} action={rsvpAction} idempotencyKey={newId()} />
    </main>
  );
}
