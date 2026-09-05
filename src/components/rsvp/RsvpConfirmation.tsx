import Link from 'next/link';
import type { SubmitRsvpOutput } from '@/capabilities/rsvp';
import { formatDeadline } from '@/domain/events/format';
import { Notice } from './fields';

/** Confirmation screen: restates what was submitted and how to change it (wedding-site-standards §3). */
export function RsvpConfirmation({ result }: { result: SubmitRsvpOutput }) {
  const byEvent = new Map<string, SubmitRsvpOutput['lines']>();
  for (const line of result.lines) byEvent.set(line.eventName, [...(byEvent.get(line.eventName) ?? []), line]);
  return (
    <div>
      <Notice tone="success" title="Thank you — you are all set">
        <p id="done-title" tabIndex={-1}>
          Here is what we have for your household.
        </p>
      </Notice>
      {[...byEvent.entries()].map(([eventName, lines]) => (
        <section key={eventName} className="card" aria-label={eventName}>
          <h2 className="card__title">{eventName}</h2>
          <ul className="list list--plain">
            {lines.map((l) => (
              <li key={`${l.guestId}-${l.eventId}`}>
                <strong>{l.guestName}</strong>: {l.status === 'accepted' ? 'attending' : 'not attending'}
                {l.mealLabel ? `, ${l.mealLabel}` : ''}
                {l.plusOne?.attending ? `, bringing ${l.plusOne.name ?? 'a guest'}${l.plusOne.mealLabel ? ` (${l.plusOne.mealLabel})` : ''}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {result.needsRecordedFor.length ? <p>Notes recorded for {result.needsRecordedFor.join(', ')}. Only the caterer and planner see them.</p> : null}
      <p>{result.emailQueued ? 'A confirmation is on its way to your e-mail. ' : ''}To change anything, come back to this page{result.editableUntil ? ` before ${formatDeadline(result.editableUntil)}` : ' while RSVPs are open'} — your latest answers always win.</p>
      <p>
        <Link className="btn btn--secondary" href="/your-weekend">
          See your weekend
        </Link>
      </p>
    </div>
  );
}
