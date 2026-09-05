'use client';

import { useActionState, useId } from 'react';
import { formatChicagoTime, formatLocalClock, formatLocalDay } from '@/domain/travel/format';
import { formatDuration, formatMoney, REFRESH_BEFORE_BOOKING } from '@/domain/travel/snapshot';
import type { FlightSearchOutcome, HotelSearchOutcome } from '@/domain/travel/types';
import { searchAction, type SearchFormState } from './actions';
import { HandoffList } from './handoff';

const INITIAL: SearchFormState = { status: 'idle', values: {} };
const INPUT = 'mt-1 block w-full min-h-11 rounded-sm border border-primary/40 bg-neutral px-3 py-2 text-base text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON = 'inline-flex min-h-11 items-center rounded-sm border border-primary bg-primary px-5 py-2 text-base font-medium text-neutral disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Defaults = Partial<Record<string, string>>;

function useValues(state: SearchFormState, defaults: Defaults) {
  const value = (name: string, fallback = '') => state.values[name] ?? defaults[name] ?? fallback;
  const issue = (path: string) => (state.status === 'error' ? state.error.issues.find((i) => i.path === path)?.message : undefined);
  return { value, issue };
}

function Field({ label, name, issue, children, hint }: { label: string; name: string; issue?: string; hint?: string; children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = issue ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-primary/70">
          {hint}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: !!issue })}
      {issue ? (
        <p id={errId} className="mt-1 text-sm font-medium text-primary" role="alert">
          {issue}
        </p>
      ) : null}
      <span className="hidden">{name}</span>
    </div>
  );
}

function ErrorSummary({ state }: { state: SearchFormState }) {
  if (state.status !== 'error') return null;
  return (
    <div role="alert" className="rounded-sm border border-primary p-3">
      <p className="font-medium">{state.error.message}</p>
      {state.error.issues.length ? (
        <ul className="mt-1 list-disc pl-5 text-sm">
          {state.error.issues.map((i) => (
            <li key={i.path}>{i.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SnapshotNote({ retrievedAt }: { retrievedAt: string }) {
  return (
    <p className="text-sm text-primary/80">
      Prices as of {formatChicagoTime(retrievedAt)}. {REFRESH_BEFORE_BOOKING}
    </p>
  );
}

function FlightResults({ outcome }: { outcome: FlightSearchOutcome }) {
  if (outcome.mode !== 'live' || !outcome.snapshot) {
    return (
      <div>
        <p className="font-medium">{outcome.notice ?? 'Live search is not available right now.'}</p>
        <HandoffList handoffs={outcome.handoffs} heading="Search directly with a partner" />
      </div>
    );
  }
  const { snapshot } = outcome;
  return (
    <div>
      <h3 className="text-lg font-semibold">
        {snapshot.results.length} option{snapshot.results.length === 1 ? '' : 's'} from {snapshot.provider}
      </h3>
      <SnapshotNote retrievedAt={snapshot.retrievedAt} />
      <ol className="mt-3 flex flex-col gap-3">
        {snapshot.results.map((f) => (
          <li key={f.id} className="rounded-sm border border-primary/20 p-4">
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{f.carrier}</span>
              <span className="text-xl font-semibold tabular-nums">{formatMoney(f.priceCents, f.currency) ?? 'Price on partner site'}</span>
            </p>
            <p className="mt-1 tabular-nums">
              {formatLocalDay(f.departAt)} · {formatLocalClock(f.departAt)} {f.origin} → {formatLocalClock(f.arriveAt)} {f.destination} (local times) · {formatDuration(f.durationMinutes)}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-medium">{f.transferLabel}</span>
              {f.transferCaution ? <span> — {f.transferCaution}</span> : null}
            </p>
            {f.pricedAt ? <p className="text-sm text-primary/70">Price seen at {formatChicagoTime(f.pricedAt)}</p> : null}
            {f.bookingUrl ? (
              <p className="mt-2">
                <a className="underline underline-offset-4" href={f.bookingUrl} target="_blank" rel="noopener noreferrer external">
                  Continue on {f.bookingProvider ?? 'the partner site'}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <HandoffList handoffs={outcome.handoffs} heading="Or compare on a partner site" />
    </div>
  );
}

function HotelResults({ outcome }: { outcome: HotelSearchOutcome }) {
  if (outcome.mode !== 'live' || !outcome.snapshot) {
    return (
      <div>
        <p className="font-medium">{outcome.notice ?? 'Live rates are not available right now.'}</p>
        <HandoffList handoffs={outcome.handoffs} heading="Check rates directly with a partner" />
      </div>
    );
  }
  const { snapshot } = outcome;
  return (
    <div>
      <h3 className="text-lg font-semibold">Rates from {snapshot.provider}</h3>
      <SnapshotNote retrievedAt={snapshot.retrievedAt} />
      <ul className="mt-3 flex flex-col gap-3">
        {snapshot.results.map((h) => (
          <li key={h.id} className="rounded-sm border border-primary/20 p-4">
            <p className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{h.name}</span>
              <span className="text-xl font-semibold tabular-nums">{h.nightlyCents !== undefined ? `${formatMoney(h.nightlyCents, h.currency)} / night` : h.isVenue ? 'Rates on the hotel site' : 'Rate on partner site'}</span>
            </p>
            {h.address ? <p className="mt-1 text-primary/80">{h.address}</p> : null}
            {h.walkMinutesToVenue !== undefined ? <p className="mt-1 text-sm">{h.walkMinutesToVenue} min walk to the CAA</p> : null}
            {h.bookingUrl ? (
              <p className="mt-2">
                <a className="underline underline-offset-4" href={h.bookingUrl} target="_blank" rel="noopener noreferrer external">
                  {h.isVenue ? 'Visit the hotel website' : 'Continue to book'}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <HandoffList handoffs={outcome.handoffs} heading="Or compare on a partner site" />
    </div>
  );
}

export function FlightSearchForm({ defaults = {} }: { defaults?: Defaults }) {
  const [state, action, pending] = useActionState(searchAction, INITIAL);
  const { value, issue } = useValues(state, defaults);
  const helpId = useId();
  return (
    <form action={action} aria-describedby={helpId} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value="flights" />
      <p id={helpId} className="text-sm text-primary/80">
        We only search when you press the button, and nothing is booked or charged here. Prices come from the partner and change often.
      </p>
      <ErrorSummary state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Flying from" name="origin" hint="3-letter airport code, for example LAX" issue={issue('origin')}>
          {(p) => <input id={p.id} name="origin" defaultValue={value('origin')} required maxLength={3} autoCapitalize="characters" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Flying to" name="destination" issue={issue('destination')}>
          {(p) => (
            <select id={p.id} name="destination" defaultValue={value('destination', 'ORD')} aria-describedby={p.describedBy} className={INPUT}>
              <option value="ORD">Chicago O&rsquo;Hare (ORD)</option>
              <option value="MDW">Chicago Midway (MDW)</option>
            </select>
          )}
        </Field>
        <Field label="Depart" name="departDate" issue={issue('departDate')}>
          {(p) => <input id={p.id} type="date" name="departDate" defaultValue={value('departDate')} required aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Return (optional)" name="returnDate" issue={issue('returnDate')}>
          {(p) => <input id={p.id} type="date" name="returnDate" defaultValue={value('returnDate')} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Adults" name="adults" issue={issue('adults')}>
          {(p) => <input id={p.id} type="number" name="adults" min={1} max={9} defaultValue={value('adults', '1')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Children" name="children" issue={issue('children')}>
          {(p) => <input id={p.id} type="number" name="children" min={0} max={9} defaultValue={value('children', '0')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Cabin" name="cabin" issue={issue('cabin')}>
          {(p) => (
            <select id={p.id} name="cabin" defaultValue={value('cabin', 'economy')} aria-describedby={p.describedBy} className={INPUT}>
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          )}
        </Field>
        <div className="flex items-end">
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" name="nonstopOnly" defaultChecked={value('nonstopOnly') === 'on'} className="h-5 w-5" />
            Nonstop only
          </label>
        </div>
      </div>
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Searching…' : 'Search flights'}
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {state.status === 'ok' && state.outcome.kind === 'flights' ? <FlightResults outcome={state.outcome} /> : null}
      </div>
    </form>
  );
}

export function HotelSearchForm({ defaults = {} }: { defaults?: Defaults }) {
  const [state, action, pending] = useActionState(searchAction, INITIAL);
  const { value, issue } = useValues(state, defaults);
  const helpId = useId();
  return (
    <form action={action} aria-describedby={helpId} className="flex flex-col gap-4">
      <input type="hidden" name="kind" value="hotels" />
      <p id={helpId} className="text-sm text-primary/80">
        Live rates near the venue, only when you ask. The wedding block above has its own link once the planner confirms it.
      </p>
      <ErrorSummary state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Check in" name="checkIn" issue={issue('checkIn')}>
          {(p) => <input id={p.id} type="date" name="checkIn" defaultValue={value('checkIn', '2027-07-16')} required aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Check out" name="checkOut" issue={issue('checkOut')}>
          {(p) => <input id={p.id} type="date" name="checkOut" defaultValue={value('checkOut', '2027-07-18')} required aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Adults" name="adults" issue={issue('adults')}>
          {(p) => <input id={p.id} type="number" name="adults" min={1} max={9} defaultValue={value('adults', '2')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Children" name="children" issue={issue('children')}>
          {(p) => <input id={p.id} type="number" name="children" min={0} max={9} defaultValue={value('children', '0')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Rooms" name="rooms" issue={issue('rooms')}>
          {(p) => <input id={p.id} type="number" name="rooms" min={1} max={9} defaultValue={value('rooms', '1')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
      </div>
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Checking…' : 'Check rates'}
        </button>
      </div>
      <div aria-live="polite" aria-busy={pending}>
        {state.status === 'ok' && state.outcome.kind === 'hotels' ? <HotelResults outcome={state.outcome} /> : null}
      </div>
    </form>
  );
}
