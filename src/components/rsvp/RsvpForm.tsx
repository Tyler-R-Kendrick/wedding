'use client';

import { Placeholder } from '@/components/provenance/Placeholder';
import { useActionState, useEffect, type ReactNode } from 'react';
import type { MyRsvp } from '@/capabilities/rsvp';
import { formatDeadline } from '@/domain/events/format';
import { Button, Checkbox, ChoiceGroup, ErrorSummary, Field, Select, Textarea, TextInput } from './fields';
import { GuestCard, GuestNotice, GuestSection } from '@/themes/guest';
import type { ThemeId } from '@/themes/types';
import { RsvpReview } from './RsvpReview';
import { RsvpConfirmation } from './RsvpConfirmation';
import { fieldNames, INITIAL_RSVP_STATE, type RsvpFormState } from './types';

export interface RsvpFormProps {
  data: MyRsvp;
  action: (prev: RsvpFormState, fd: FormData) => Promise<RsvpFormState>;
  /** Per-render ULID: a double submit replays instead of writing twice. */
  idempotencyKey: string;
  /**
   * The active design. This is a `'use client'` component, so it cannot resolve the theme itself —
   * `getRequestTheme()` reads request headers — and it must not import a theme KIT, which would pull
   * dialogs, the switcher and the countdown into the guest bundle. `themes/guest.tsx` is the one
   * import that is safe here: two pure presentational components and nothing else.
   */
  theme: ThemeId;
}

/**
 * Household RSVP form (recipe). Progressive: works without JavaScript, every field has a visible
 * label, errors are text bound to their field, inputs are 17px+, and the review step is inline.
 */
export function RsvpForm({ data, action, idempotencyKey, theme }: RsvpFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_RSVP_STATE);

  useEffect(() => {
    if (state.stage === 'form' && (Object.keys(state.errors).length || state.messages.length)) document.getElementById('error-summary')?.focus();
    if (state.stage === 'review') document.getElementById('review-title')?.focus();
    if (state.stage === 'done') document.getElementById('done-title')?.focus();
  }, [state]);

  if (state.stage === 'done') return <RsvpConfirmation result={state.result} theme={theme} />;
  if (state.stage === 'review') return <RsvpReview state={state} formAction={formAction} pending={pending} theme={theme} />;

  // A closed window is answered before the guest spends any effort, not after. Leaving 23 editable
  // fields behind a disabled submit button let someone answer for a whole household and only find
  // out at the bottom — and a disabled button is not focusable, so a keyboard or screen-reader user
  // reached the end and was told nothing at all.
  if (!data.window.open) return <RsvpClosed data={data} theme={theme} />;

  const values = state.values;
  const existing = (g: string, e: string) => data.responses.find((r) => r.guestId === g && r.eventId === e);
  const valued = (g: string, e: string) => values?.responses.find((r) => r.guestId === g && r.eventId === e);
  const guestById = new Map(data.guests.map((g) => [g.guestId, g]));
  const errorList = [...state.messages.map((m) => ({ message: m })), ...Object.entries(state.errors).map(([k, m]) => ({ href: `#${cssId(k)}`, message: m }))];

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <ErrorSummary errors={errorList} />
      {data.events.map((event, eventIndex) => (
        <GuestSection theme={theme} key={event.id} id={`ev-${event.id}`} index={eventIndex} title={event.name}>
          <p className="card__meta">
            {event.dateText} · {event.whenText}
            {event.placeholder ? <span className="card__meta"> · details to come</span> : null}
          </p>
          {event.invited.map(({ guestId, plusOnePolicy }) => {
            const guest = guestById.get(guestId);
            if (!guest) return null;
            const prev = valued(guestId, event.id);
            const onFile = existing(guestId, event.id);
            const status = prev?.status ?? onFile?.status;
            const meal = prev?.mealOptionId ?? (onFile && !onFile.mealStale ? onFile.mealOptionId : null);
            const plusOne = prev?.plusOne ?? onFile?.plusOne ?? null;
            const base = `${guestId}-${event.id}`;
            return (
              <GuestCard theme={theme} key={guestId} title={guest.displayName}>
                {onFile ? <p className="card__meta">On file: {onFile.status === 'accepted' ? 'attending' : 'not attending'}{onFile.mealStale ? ' — the menu changed, please choose a meal again' : ''}.</p> : null}
                <ChoiceGroup
                  idBase={cssId(fieldNames.status(guestId, event.id))}
                  name={fieldNames.status(guestId, event.id)}
                  legend={`Will ${guest.firstName} attend the ${event.name.toLowerCase()}?`}
                  error={state.errors[fieldNames.status(guestId, event.id)]}
                  options={[
                    { value: 'accepted', label: 'Yes, attending', defaultChecked: status === 'accepted' },
                    { value: 'declined', label: 'No, cannot make it', defaultChecked: status === 'declined' },
                  ]}
                />
                {event.hasMeal ? (
                  <Field id={cssId(fieldNames.meal(guestId, event.id))} label={`Meal for ${guest.firstName}`} hint="Only needed if attending." error={state.errors[fieldNames.meal(guestId, event.id)]}>
                    {(a) => (
                      <Select id={a.id} name={fieldNames.meal(guestId, event.id)} describedBy={a.describedBy} invalid={a.invalid} defaultValue={meal ?? ''} placeholderLabel="Choose a meal">
                        {event.mealOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                            {m.description ? ` — ${m.description}` : ''}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}
                {plusOnePolicy !== 'none' ? (
                  <fieldset className="fld" style={{ marginTop: 'var(--spacing-md)' }}>
                    <legend className="fld__label">Guest of {guest.firstName}</legend>
                    <p className="fld__hint" id={`${base}-p1-hint`}>
                      {plusOnePolicy === 'named' ? 'Your invitation includes one guest. Please tell us their name.' : 'Your invitation includes one guest. A name is optional.'}
                    </p>
                    {state.errors[fieldNames.plusOne(guestId, event.id)] ? (
                      <p className="fld__error" role="alert">
                        {state.errors[fieldNames.plusOne(guestId, event.id)]}
                      </p>
                    ) : null}
                    <Checkbox id={cssId(fieldNames.plusOne(guestId, event.id))} name={fieldNames.plusOne(guestId, event.id)} label={`${guest.firstName} is bringing a guest`} defaultChecked={plusOne?.attending === true} describedBy={`${base}-p1-hint`} />
                    <Field id={cssId(fieldNames.plusOneName(guestId, event.id))} label="Guest's name" error={state.errors[fieldNames.plusOneName(guestId, event.id)]} required={plusOnePolicy === 'named'}>
                      {(a) => <TextInput id={a.id} name={fieldNames.plusOneName(guestId, event.id)} describedBy={a.describedBy} invalid={a.invalid} defaultValue={plusOne?.name ?? ''} autoComplete="off" maxLength={80} />}
                    </Field>
                    {event.hasMeal ? (
                      <Field id={cssId(fieldNames.plusOneMeal(guestId, event.id))} label="Meal for the guest" error={state.errors[fieldNames.plusOneMeal(guestId, event.id)]}>
                        {(a) => (
                          <Select id={a.id} name={fieldNames.plusOneMeal(guestId, event.id)} describedBy={a.describedBy} invalid={a.invalid} defaultValue={plusOne?.mealOptionId ?? ''} placeholderLabel="Choose a meal">
                            {event.mealOptions.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    ) : null}
                  </fieldset>
                ) : null}
              </GuestCard>
            );
          })}
        </GuestSection>
      ))}

      <GuestSection theme={theme} id="needs" index={data.events.length} title="Anything we should know?">
        <p className="card__meta">Allergies, dietary needs, mobility or seating needs. We share these only with the caterer and the planner.</p>
        {data.guests.map((g) => {
          const prevNeeds = values?.needs.find((n) => n.guestId === g.guestId) ?? data.needs.find((n) => n.guestId === g.guestId);
          return (
            <GuestCard theme={theme} key={g.guestId} title={g.displayName}>
              <Field id={cssId(fieldNames.dietary(g.guestId))} label="Dietary needs or allergies" error={state.errors[fieldNames.dietary(g.guestId)]}>
                {(a) => <Textarea id={a.id} name={fieldNames.dietary(g.guestId)} describedBy={a.describedBy} invalid={a.invalid} defaultValue={prevNeeds?.dietary ?? ''} maxLength={500} rows={2} />}
              </Field>
              <Field id={cssId(fieldNames.accessibility(g.guestId))} label="Accessibility or seating needs" error={state.errors[fieldNames.accessibility(g.guestId)]}>
                {(a) => <Textarea id={a.id} name={fieldNames.accessibility(g.guestId)} describedBy={a.describedBy} invalid={a.invalid} defaultValue={prevNeeds?.accessibility ?? ''} maxLength={500} rows={2} />}
              </Field>
            </GuestCard>
          );
        })}
      </GuestSection>

      <p className="card__meta">
        {data.window.deadlineAt ? `Please answer by ${formatDeadline(data.window.deadlineAt)}. You can change your answers until then.` : 'You can change your answers any time while RSVPs are open.'}
      </p>
      <div className="actions">
        <Button type="submit" name="intent" value="draft" pending={pending}>
          Review your answers
        </Button>
      </div>
    </form>
  );
}

/** Field names contain ids and colons; DOM ids must be simpler. */
export function cssId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * What a guest sees when the form is not open: the answers already on file, read-only, and who to
 * ask. No form controls at all — nothing here can be edited, so nothing here pretends to be.
 *
 * The heading and the sentence depend on WHY it is shut, and that distinction is the point.
 * `rsvpWindow` has always returned a `reason`; this component ignored it and said "RSVPs are closed
 * … the guest list has gone to the venue" for every case — including `lifecycle`, which means RSVPs
 * have not opened YET. A guest signing in during the teaser was told the list had gone to the venue
 * before it existed. That is the plausible fiction PRODUCT.md forbids, told to the person it most
 * misleads, and it read as correct because the words are the ones a closed RSVP would use.
 */
function closedCopy(reason: MyRsvp['window']['reason']): { title: string; body: ReactNode } {
  if (reason === 'lifecycle') {
    return {
      title: 'RSVPs are not open yet',
      body: (
        <>
          Sara and Tyler will send word when it is time to reply, and this page is where you will do it. Nothing is needed from you today.{' '}
          <Placeholder inline>the date RSVPs open</Placeholder>
        </>
      ),
    };
  }
  if (reason === 'deadline_passed') {
    return {
      title: 'RSVPs have closed',
      body: (
        <>
          The deadline has passed and the guest list has gone to the venue. If something has changed, reach Sara and Tyler and they will update it for you.{' '}
          <Placeholder inline>their contact details</Placeholder>
        </>
      ),
    };
  }
  // `manual_closed`: an admin shut the window deliberately, and the app does not know their reason.
  // It must not invent one — "the list has gone to the venue" is a guess, not a fact.
  return {
    title: 'RSVPs are closed for now',
    body: (
      <>
        Replies are paused. Reach Sara and Tyler if you need to change something and they will sort it out.{' '}
        <Placeholder inline>their contact details</Placeholder>
      </>
    ),
  };
}

// The wrapper is the active design's section, for the same reason the open form's is; `closedCopy`
// and the notice above it are untouched — they are the coordinator's fix for the window `reason`,
// and this is the shell around them.
function RsvpClosed({ data, theme }: { data: MyRsvp; theme: ThemeId }) {
  const guestById = new Map(data.guests.map((g) => [g.guestId, g]));
  const answered = data.responses.length > 0;
  const copy = closedCopy(data.window.reason);
  return (
    <>
      {/* The design's own callout, not the shared `.notice`. In the lifecycle states where the
          window is shut this notice IS the page, which is why /rsvp still measured zero themed
          elements after the sections were themed. `closedCopy` and the branch above are the
          coordinator's fix for the window `reason` and are untouched — only the frame is. */}
      <GuestNotice theme={theme} tone="info" title={copy.title}>
        <p>{copy.body}</p>
      </GuestNotice>
      {answered ? (
        data.events.map((event, eventIndex) => {
          const rows = data.responses.filter((r) => r.eventId === event.id);
          if (!rows.length) return null;
          return (
            <GuestSection theme={theme} key={event.id} id={`closed-${event.id}`} index={eventIndex} title={event.name}>
              <p className="card__meta">
                {event.dateText} · {event.whenText}
              </p>
              <ul className="list list--plain">
                {rows.map((r) => (
                  <li key={`${r.guestId}-${r.eventId}`}>
                    <strong>{guestById.get(r.guestId)?.displayName ?? 'Guest'}</strong>: {STATUS_TEXT[r.status]}
                    {r.mealLabel ? ` · ${r.mealLabel}` : ''}
                    {r.plusOne?.attending ? ` · with ${r.plusOne.name ?? 'a guest'}` : ''}
                  </li>
                ))}
              </ul>
            </GuestSection>
          );
        })
      ) : (
        <p>We have no answer on file for your household.</p>
      )}
    </>
  );
}

const STATUS_TEXT: Record<string, string> = { accepted: 'coming', declined: 'not coming', pending: 'no answer yet' };
