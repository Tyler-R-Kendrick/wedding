import { formatDeadline } from '@/domain/events/format';
import { Button } from './fields';
import type { RsvpFormState } from './types';

type ReviewState = Extract<RsvpFormState, { stage: 'review' }>;

/** Inline confirmation step: restates every answer before anything is saved. */
export function RsvpReview({ state, formAction, pending }: { state: ReviewState; formAction: (fd: FormData) => void; pending: boolean }) {
  const byEvent = new Map<string, ReviewState['proposal']['lines']>();
  for (const line of state.proposal.lines) byEvent.set(line.eventName, [...(byEvent.get(line.eventName) ?? []), line]);
  return (
    <form action={formAction}>
      <input type="hidden" name="submission" value={JSON.stringify(state.submission)} />
      <input type="hidden" name="token" value={state.token} />
      <input type="hidden" name="idempotencyKey" value={state.idempotencyKey} />
      <h2 className="sec__title" id="review-title" tabIndex={-1}>
        Please check your answers
      </h2>
      <p className="card__meta">Nothing is saved yet. Confirm below, or go back to change anything.</p>
      {[...byEvent.entries()].map(([eventName, lines]) => (
        <section key={eventName} className="card" aria-label={eventName}>
          <h3 className="card__title">{eventName}</h3>
          <dl className="review">
            {lines.map((l) => (
              <div key={`${l.guestId}-${l.eventId}`} className="review__row">
                <dt className="review__who">{l.guestName}</dt>
                <dd style={{ margin: 0 }}>
                  {l.status === 'accepted' ? 'Attending' : 'Not attending'}
                  {l.mealLabel ? ` · ${l.mealLabel}` : ''}
                  {l.plusOne?.attending ? ` · bringing ${l.plusOne.name ?? 'a guest'}${l.plusOne.mealLabel ? ` (${l.plusOne.mealLabel})` : ''}` : ''}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {state.proposal.needsRecordedFor.length ? <p>Dietary and accessibility notes will be recorded for {state.proposal.needsRecordedFor.join(', ')}.</p> : null}
      <p className="card__meta">{state.editableUntil ? `You can change this until ${formatDeadline(state.editableUntil)}.` : 'You can change this while RSVPs are open.'}</p>
      <div className="actions">
        <Button type="submit" name="intent" value="confirm" pending={pending}>
          Confirm and send
        </Button>
        <Button type="submit" name="intent" value="edit" variant="secondary" disabled={pending}>
          Go back and change
        </Button>
      </div>
    </form>
  );
}
