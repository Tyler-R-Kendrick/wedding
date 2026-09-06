'use client';

import { useActionState, useId, useRef } from 'react';
import { newId } from '@/contracts/ids';
import type { LocationSuggestion, TravelProfile } from '@/domain/travel/types';
import { addItemAction, saveProfileAction, type AddItemFormState, type ProfileFormState } from './actions';

const INPUT = 'mt-1 block w-full min-h-11 rounded-sm border border-primary/40 bg-neutral px-3 py-2 text-base text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON = 'inline-flex min-h-11 items-center rounded-sm border border-primary bg-primary px-5 py-2 text-base font-medium text-neutral disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * A fresh idempotency key per submit, written into the hidden field just before the action runs
 * (the field starts empty so server and client markup match; without JavaScript the server mints one).
 */
function refreshKey(ref: React.RefObject<HTMLInputElement | null>) {
  if (ref.current) ref.current.value = newId();
}

function Field({ label, hint, issue, children }: { label: string; hint?: string; issue?: string; children: (p: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode }) {
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
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: !!issue })}
      {issue ? (
        <p id={errId} role="alert" className="mt-1 font-medium">
          {issue}
        </p>
      ) : null}
    </div>
  );
}

function Summary({ state }: { state: { status: string; error?: { message: string; issues: { path: string; message: string }[] } } }) {
  if (state.status !== 'error' || !state.error) return null;
  return (
    <div role="alert" className="rounded-sm border border-primary p-3">
      <p className="font-medium">{state.error.message}</p>
      {state.error.issues.length ? (
        <ul className="mt-1 list-disc pl-5">
          {state.error.issues.map((i) => (
            <li key={i.path}>
              {i.path}: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ProfileForm({ profile, suggestion }: { profile: TravelProfile | null; suggestion: LocationSuggestion | null }) {
  const [state, action, pending] = useActionState(saveProfileAction, { status: 'idle', values: {} } as ProfileFormState);
  const keyRef = useRef<HTMLInputElement>(null);
  const current = state.status === 'saved' ? state.profile ?? profile : profile;
  const v = (name: string, fromProfile: string | number | null | undefined, fallback = '') => state.values[name] ?? (fromProfile === null || fromProfile === undefined ? fallback : String(fromProfile));
  const issue = (path: string) => (state.status === 'error' ? state.error.issues.find((i) => i.path === path)?.message : undefined);
  const helpId = useId();
  return (
    <form action={action} onSubmit={() => refreshKey(keyRef)} aria-describedby={helpId} className="flex flex-col gap-4">
      <input ref={keyRef} type="hidden" name="idempotencyKey" defaultValue="" />
      <p id={helpId} className="hint">
        Optional. Saving tells us you want flight and hotel searches pre-filled. We never guess where you are; you can delete this any time.
      </p>
      {suggestion && !current ? (
        <p className="rounded-sm border border-primary/30 p-3">
          Your invitation was addressed to {[suggestion.city, suggestion.region].filter(Boolean).join(', ')}
          {suggestion.airport ? ` (nearest airport ${suggestion.airport})` : ''}. Use that below if it is right.
        </p>
      ) : null}
      {state.status === 'saved' ? (
        <p role="status" className="rounded-sm border border-primary/30 p-3">
          Saved. Your searches on Travel &amp; Stay now start from these preferences.
        </p>
      ) : null}
      <Summary state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Home city" issue={issue('homeCity')}>
          {(p) => <input id={p.id} name="homeCity" defaultValue={v('homeCity', current?.homeCity, suggestion?.city)} maxLength={80} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="State or country" issue={issue('homeRegion')}>
          {(p) => <input id={p.id} name="homeRegion" defaultValue={v('homeRegion', current?.homeRegion, suggestion?.region)} maxLength={80} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Preferred airport" hint="3-letter code, for example LAX" issue={issue('preferredAirport')}>
          {(p) => <input id={p.id} name="preferredAirport" defaultValue={v('preferredAirport', current?.preferredAirport, suggestion?.airport)} maxLength={3} autoCapitalize="characters" aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Other airports you could use" hint="Codes separated by commas" issue={issue('alternateAirports')}>
          {(p) => <input id={p.id} name="alternateAirports" defaultValue={v('alternateAirports', current?.alternateAirports.join(', '))} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Adults travelling" issue={issue('adults')}>
          {(p) => <input id={p.id} type="number" name="adults" min={1} max={9} defaultValue={v('adults', current?.adults, '1')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Children travelling" issue={issue('children')}>
          {(p) => <input id={p.id} type="number" name="children" min={0} max={9} defaultValue={v('children', current?.children, '0')} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Preferred airline (optional)" issue={issue('airlinePreference')}>
          {(p) => <input id={p.id} name="airlinePreference" defaultValue={v('airlinePreference', current?.airlinePreference)} maxLength={60} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Cabin" issue={issue('cabin')}>
          {(p) => (
            <select id={p.id} name="cabin" defaultValue={v('cabin', current?.cabin, 'economy')} aria-describedby={p.describedBy} className={INPUT}>
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          )}
        </Field>
        <Field label="Earliest arrival" issue={issue('arriveEarliest')}>
          {(p) => <input id={p.id} type="date" name="arriveEarliest" defaultValue={v('arriveEarliest', current?.arriveEarliest)} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Latest arrival" issue={issue('arriveLatest')}>
          {(p) => <input id={p.id} type="date" name="arriveLatest" defaultValue={v('arriveLatest', current?.arriveLatest)} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Earliest departure" issue={issue('departEarliest')}>
          {(p) => <input id={p.id} type="date" name="departEarliest" defaultValue={v('departEarliest', current?.departEarliest)} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Latest departure" issue={issue('departLatest')}>
          {(p) => <input id={p.id} type="date" name="departLatest" defaultValue={v('departLatest', current?.departLatest)} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <div className="flex items-end">
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" name="nonstopPreferred" defaultChecked={(state.values.nonstopPreferred ?? (current?.nonstopPreferred ? 'on' : '')) === 'on'} className="h-5 w-5" />
            Prefer nonstop flights
          </label>
        </div>
      </div>
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : current ? 'Update preferences' : 'Save preferences'}
        </button>
      </div>
    </form>
  );
}

export function AddItemForm() {
  const [state, action, pending] = useActionState(addItemAction, { status: 'idle', values: {} } as AddItemFormState);
  const keyRef = useRef<HTMLInputElement>(null);
  const v = (name: string, fallback = '') => state.values[name] ?? fallback;
  const issue = (path: string) => (state.status === 'error' ? state.error.issues.find((i) => i.path === path)?.message : undefined);
  const helpId = useId();
  return (
    <form action={action} onSubmit={() => refreshKey(keyRef)} aria-describedby={helpId} className="flex flex-col gap-4">
      <input ref={keyRef} type="hidden" name="idempotencyKey" defaultValue="" />
      <p id={helpId} className="hint">
        Add what you have booked or plan to book. Times are in the time zone you pick. Adding an item does not book anything.
      </p>
      {state.status === 'added' ? (
        <p role="status" className="rounded-sm border border-primary/30 p-3">
          Added to your trip.
        </p>
      ) : null}
      <Summary state={state} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="What is it" issue={issue('kind')}>
          {(p) => (
            <select id={p.id} name="kind" defaultValue={v('kind', 'flight')} aria-describedby={p.describedBy} className={INPUT}>
              <option value="flight">Flight</option>
              <option value="hotel">Hotel stay</option>
              <option value="other">Something else</option>
            </select>
          )}
        </Field>
        <Field label="Title" hint="For example: UA 1234 LAX to ORD" issue={issue('title')}>
          {(p) => <input id={p.id} name="title" defaultValue={v('title')} required maxLength={120} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Starts" issue={issue('startAt')}>
          {(p) => <input id={p.id} type="datetime-local" name="startAt" defaultValue={v('startAt')} required aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Ends (optional)" issue={issue('endAt')}>
          {(p) => <input id={p.id} type="datetime-local" name="endAt" defaultValue={v('endAt')} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} className={INPUT} />}
        </Field>
        <Field label="Time zone of those times" issue={issue('timezone')}>
          {(p) => (
            <select id={p.id} name="timezone" defaultValue={v('timezone', 'America/Chicago')} aria-describedby={p.describedBy} className={INPUT}>
              <option value="America/Chicago">Chicago (Central)</option>
              <option value="America/New_York">Eastern</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Phoenix">Arizona</option>
              <option value="America/Los_Angeles">Pacific (California, Nevada)</option>
              <option value="Pacific/Honolulu">Hawaii</option>
              <option value="UTC">UTC</option>
            </select>
          )}
        </Field>
        <Field label="Booking reference (optional)" issue={issue('providerRef')}>
          {(p) => <input id={p.id} name="providerRef" defaultValue={v('providerRef')} maxLength={64} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="From airport (flights)" issue={issue('details.origin')}>
          {(p) => <input id={p.id} name="origin" defaultValue={v('origin')} maxLength={3} autoCapitalize="characters" aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="To airport (flights)" issue={issue('details.destination')}>
          {(p) => <input id={p.id} name="destination" defaultValue={v('destination')} maxLength={3} autoCapitalize="characters" aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Airline (flights)" issue={issue('details.carrier')}>
          {(p) => <input id={p.id} name="carrier" defaultValue={v('carrier')} maxLength={60} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Flight number" issue={issue('details.flightNumber')}>
          {(p) => <input id={p.id} name="flightNumber" defaultValue={v('flightNumber')} maxLength={12} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Hotel name (stays)" issue={issue('details.hotelName')}>
          {(p) => <input id={p.id} name="hotelName" defaultValue={v('hotelName')} maxLength={120} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
        <Field label="Address (stays)" issue={issue('details.address')}>
          {(p) => <input id={p.id} name="address" defaultValue={v('address')} maxLength={200} aria-describedby={p.describedBy} className={INPUT} />}
        </Field>
      </div>
      <Field label="Note (optional)" issue={issue('details.note')}>
        {(p) => <textarea id={p.id} name="note" defaultValue={v('note')} maxLength={500} rows={2} aria-describedby={p.describedBy} className={INPUT} />}
      </Field>
      <div>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add to my trip'}
        </button>
      </div>
    </form>
  );
}
