import type { ReservationOptionView } from '@/domain/reservations/service';
import { ExternalHandoffCard } from './ExternalHandoffCard';
import { UnavailableCard } from './UnavailableCard';

/** One rung of the reservation ladder, rendered honestly. */
export function ReservationHandoffCard({ option }: { option: ReservationOptionView }) {
  const { venue } = option;
  if (!option.handoff || option.rung === 'unavailable') {
    return <UnavailableCard heading={venue.name} message={option.unavailable?.message ?? 'We do not have a reservation link for this place yet.'} contactRoute={option.unavailable?.contactRoute} note={venue.note} placeholder={venue.placeholder} />;
  }
  return (
    <ExternalHandoffCard
      heading={venue.name}
      handoff={option.handoff}
      note={venue.note}
      placeholder={venue.placeholder}
      meta={venue.verifiedAt ? <span>Last checked <time dateTime={venue.verifiedAt}>{new Date(venue.verifiedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</time></span> : undefined}
      recordVia={{ capability: 'open_reservation_link', input: { venueId: venue.id } }}
    />
  );
}
