import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PageRecipe } from '@/app/(public)/travel/_shared/recipe';
import { newId } from '@/contracts/ids';
import { formatChicagoDateTime, formatLongDate, type FreeTimeWindow, type LocationSuggestion, type RoomBlockInput, type TravelProfile, type TripItem } from '@/domain/travel';
import { deleteProfileAction, hostedFlightsAction, itemAction } from './actions';

export interface TripPageData {
  trip: {
    weddingDate: string;
    items: TripItem[];
    freeTime: FreeTimeWindow[];
    block: { hotelName: string; block: RoomBlockInput | null; placeholder: boolean };
    hostedBookingAvailable: boolean;
  };
  profile: TravelProfile | null;
  suggestion: LocationSuggestion | null;
  /** Set when the guest came back from a hosted checkout (`?ref=<item>&outcome=...`). Never auto-confirms. */
  returned: { itemId: string; outcome: string } | null;
  notice: string | null;
}

export interface TripPageSlots {
  profileForm: ReactNode;
  addItemForm: ReactNode;
}

const BUTTON = 'inline-flex min-h-11 items-center rounded-sm border border-primary px-4 py-2 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const INPUT = 'min-h-11 rounded-sm border border-primary/40 bg-neutral px-3 py-2 text-base';

const STATUS_LABEL: Record<TripItem['status'], string> = { planned: 'Planned', confirmed: 'Confirmed', cancelled: 'Cancelled' };
const KIND_LABEL: Record<TripItem['kind'], string> = { flight: 'Flight', hotel: 'Hotel', other: 'Plan' };

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t border-primary/20 py-10">
      {eyebrow ? <p className="text-sm uppercase tracking-wide text-primary/70">{eyebrow}</p> : null}
      <h2 id={`${id}-title`} className="mt-1 text-2xl font-semibold">
        {title}
      </h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function ItemForm({ item, op, label, withReference }: { item: TripItem; op: 'confirm' | 'cancel' | 'reopen' | 'remove'; label: string; withReference?: boolean }) {
  const refId = `ref-${item.id}`;
  return (
    <form action={itemAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="idempotencyKey" value={newId()} />
      {withReference ? (
        <div>
          <label htmlFor={refId} className="block text-sm font-medium">
            Booking reference (optional)
          </label>
          <input id={refId} name="providerRef" maxLength={64} className={INPUT} defaultValue={item.providerRef ?? ''} />
        </div>
      ) : null}
      <button type="submit" className={BUTTON}>
        {label}
      </button>
    </form>
  );
}

function ItemCard({ item, highlighted }: { item: TripItem; highlighted: boolean }) {
  const d = item.details;
  const detailLine = [d.carrier && d.flightNumber ? `${d.carrier} ${d.flightNumber}` : d.carrier, d.origin && d.destination ? `${d.origin} → ${d.destination}` : null, d.hotelName, d.address].filter(Boolean).join(' · ');
  return (
    <li className={`rounded-sm border p-5 ${highlighted ? 'border-primary' : 'border-primary/20'}`} aria-current={highlighted ? 'true' : undefined}>
      <p className="text-sm uppercase tracking-wide text-primary/70">
        {KIND_LABEL[item.kind]} · {STATUS_LABEL[item.status]}
        {item.confirmedVia ? ` (${item.confirmedVia === 'guest' ? 'by you' : 'by the booking partner'})` : ''}
      </p>
      <h3 className="mt-1 text-lg font-semibold">{item.title}</h3>
      <p className="mt-1 tabular-nums">
        {formatChicagoDateTime(item.startAt)}
        {item.endAt ? ` → ${formatChicagoDateTime(item.endAt)}` : ''}
      </p>
      {detailLine ? <p className="mt-1 text-primary/80">{detailLine}</p> : null}
      {item.providerRef ? <p className="mt-1 text-sm">Reference {item.providerRef}</p> : null}
      {d.note ? <p className="mt-2 text-sm">{d.note}</p> : null}
      <div className="mt-4 flex flex-col gap-3">
        {item.status === 'planned' ? <ItemForm item={item} op="confirm" label="I booked this" withReference /> : null}
        <div className="flex flex-wrap gap-2">
          {item.status !== 'cancelled' ? <ItemForm item={item} op="cancel" label="Mark cancelled" /> : <ItemForm item={item} op="reopen" label="Back to planned" />}
          <ItemForm item={item} op="remove" label="Remove" />
        </div>
      </div>
    </li>
  );
}

function ReturnedBanner({ returned }: { returned: NonNullable<TripPageData['returned']> }) {
  const copy =
    returned.outcome === 'success'
      ? 'Welcome back. If the booking went through, press “I booked this” on that item and add the reference. We never mark a booking confirmed on our own.'
      : returned.outcome === 'failure'
        ? 'The booking did not complete on the partner site. We took no payment. You can try again or use the search links on Travel & Stay.'
        : 'No problem, your planned flights are still here whenever you are ready.';
  return (
    <p role="status" className="rounded-sm border border-primary p-4">
      {copy}
    </p>
  );
}

export const TripPageRecipe: PageRecipe<TripPageData, TripPageSlots> = ({ data, slots }) => {
  const { trip, returned, notice } = data;
  const block = trip.block.block;
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pb-16 pt-10">
      <header>
        <p className="text-sm uppercase tracking-wide text-primary/70">Your Weekend</p>
        <h1 className="mt-1 text-4xl font-semibold">Your trip</h1>
        <p className="mt-3 max-w-prose">Flights, where you are staying, and the free time in between. Only you and your household can see this.</p>
      </header>
      {notice ? (
        <p role="status" className="mt-6 rounded-sm border border-primary/40 p-3">
          {notice}
        </p>
      ) : null}
      {returned ? <div className="mt-6"><ReturnedBanner returned={returned} /></div> : null}

      <Section id="items" eyebrow="Plans" title="What you have so far">
        {trip.items.length ? (
          <ul className="flex flex-col gap-4">
            {trip.items.map((item) => (
              <ItemCard key={item.id} item={item} highlighted={returned?.itemId === item.id} />
            ))}
          </ul>
        ) : (
          <p>Nothing yet. Add your flights below, or search on Travel &amp; Stay and come back to record what you booked.</p>
        )}
        {trip.hostedBookingAvailable ? (
          <form action={hostedFlightsAction} className="rounded-sm border border-primary/30 p-4">
            <h3 className="text-lg font-semibold">Book flights through our partner</h3>
            <p className="mt-1 text-sm text-primary/80">Opens Duffel&rsquo;s secure booking page. We never see your payment details; come back here to confirm afterwards.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="hosted-origin" className="block text-sm font-medium">
                  From airport
                </label>
                <input id="hosted-origin" name="origin" maxLength={3} className={`${INPUT} w-full`} defaultValue={data.profile?.preferredAirport ?? ''} />
              </div>
              <div>
                <label htmlFor="hosted-depart" className="block text-sm font-medium">
                  Depart
                </label>
                <input id="hosted-depart" type="date" name="departDate" className={`${INPUT} w-full`} defaultValue={data.profile?.arriveEarliest ?? ''} />
              </div>
              <div>
                <label htmlFor="hosted-adults" className="block text-sm font-medium">
                  Adults
                </label>
                <input id="hosted-adults" type="number" name="adults" min={1} max={9} className={`${INPUT} w-full`} defaultValue={data.profile?.adults ?? 1} />
              </div>
            </div>
            <button type="submit" className={`${BUTTON} mt-3 bg-primary text-neutral`}>
              Continue securely with Duffel
            </button>
          </form>
        ) : null}
      </Section>

      <Section id="free-time" eyebrow="Adventures" title="Free time for an adventure">
        {trip.freeTime.length ? (
          <ul className="flex flex-col gap-2">
            {trip.freeTime.map((w) => (
              <li key={w.startAt} className="rounded-sm border border-primary/20 p-3">
                <p className="font-medium">{w.label}</p>
                <p className="text-sm text-primary/80 tabular-nums">
                  {formatChicagoDateTime(w.startAt)} → {formatChicagoDateTime(w.endAt)}
                </p>
                <p className="mt-1 text-sm">
                  {/* `Link` since level 05 merged: /share-an-adventure is a real route now, so this
                      is client-side navigation and gets prefetched, not a full document load. */}
                  <Link className="underline underline-offset-4" href="/share-an-adventure">
                    See what we suggest for this window
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>Add your arrival and departure flights and we will show the gaps, with ideas for each one. The wedding day itself is spoken for.</p>
        )}
      </Section>

      <Section id="block" eyebrow="Stay" title={`Room block at the ${trip.block.hotelName}`}>
        {block && !block.placeholder ? (
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-primary/70">Rate</dt>
              <dd>{block.rateText ?? 'See the hotel'}</dd>
            </div>
            <div>
              <dt className="text-sm text-primary/70">Book by</dt>
              <dd>{block.cutoff ? formatLongDate(block.cutoff) : 'See the hotel'}</dd>
            </div>
            <div>
              <dt className="text-sm text-primary/70">Code</dt>
              <dd>{block.code ?? 'None needed'}</dd>
            </div>
          </dl>
        ) : (
          <p>The block details (link, rate, dates, cutoff) are still coming from the planner. Travel &amp; Stay will update as soon as they are confirmed.</p>
        )}
        <p>
          <a className="underline underline-offset-4" href="/travel#stay">
            All the details on Travel &amp; Stay
          </a>
        </p>
      </Section>

      <Section id="add" eyebrow="Record" title="Add to your trip">
        {slots.addItemForm}
      </Section>

      <Section id="profile" eyebrow="Preferences" title="Your travel preferences">
        {slots.profileForm}
        {data.profile ? (
          <form action={deleteProfileAction} className="mt-2">
            <input type="hidden" name="idempotencyKey" value={newId()} />
            <button type="submit" className={BUTTON}>
              Delete my travel preferences
            </button>
          </form>
        ) : null}
      </Section>
    </main>
  );
};

export function TripGate({ reason }: { reason: 'anonymous' | 'forbidden' }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 pb-16 pt-10">
      <p className="text-sm uppercase tracking-wide text-primary/70">Your Weekend</p>
      <h1 className="mt-1 text-4xl font-semibold">Your trip</h1>
      <p className="mt-3 max-w-prose">
        {reason === 'anonymous' ? 'Open the link from your invitation to see and plan your trip. Until then, everything about getting here is on ' : 'This page is for invited guests. Everything about getting here is on '}
        <a className="underline underline-offset-4" href="/travel">
          Travel &amp; Stay
        </a>
        .
      </p>
    </main>
  );
}
