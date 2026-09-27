'use client';

import { AdminFlow, type FlowContext, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences, GuestPreview, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import { chicagoLocalToIso, formatDeadline, formatEventDate, formatEventWindow, isoToChicagoLocal } from '@/domain/events/format';

type Option = { value: string; label: string };

/** What the events list carries for one event: enough to open an edit without another read. */
export interface EventSummary {
  id: string;
  name: string;
  description: string | null;
  dateIso: string;
  startsAt: string | null;
  endsAt: string | null;
  venueSpaceRef: string | null;
  dressCode: string | null;
  accessibilityNote: string | null;
  placeholder: boolean;
  rsvpRequired: boolean;
  sortOrder: number;
  mealOptionsVersion: number;
  mealOptions: { id: string; label: string; description: string | null }[];
}

const TZ = 'America/Chicago';
const CHICAGO_HINT = 'Chicago time. Leave it empty until it is confirmed.';

/* ---------------------------------------------------------------- event ------------------- */

interface EventValues extends Record<string, unknown> {
  name: string;
  dateIso: string;
  startsAt: string;
  endsAt: string;
  venueSpaceRef: string;
  dressCode: string;
  description: string;
  accessibilityNote: string;
  placeholder: boolean;
  rsvpRequired: boolean;
  sortOrder: string;
}

const eventValues = (e: EventSummary | undefined, nextOrder: number): EventValues => ({
  name: e?.name ?? '',
  dateIso: e?.dateIso ?? '2027-07-17',
  startsAt: isoToChicagoLocal(e?.startsAt),
  endsAt: isoToChicagoLocal(e?.endsAt),
  venueSpaceRef: e?.venueSpaceRef ?? '',
  dressCode: e?.dressCode ?? '',
  description: e?.description ?? '',
  accessibilityNote: e?.accessibilityNote ?? '',
  placeholder: e ? e.placeholder : true,
  rsvpRequired: e ? e.rsvpRequired : true,
  sortOrder: String(e?.sortOrder ?? nextOrder),
});

const validOrder = (s: string) => /^\d{1,4}$/.test(s.trim()) && Number(s) <= 1000;

/**
 * Add an event, or edit one: what and when, where and what guests should know, how it shows on
 * the site, then the event read back. Replaces a long form per event plus a blank one at the end.
 */
export function EventFlow({ event, rooms, others, nextOrder, label, variant = 'primary' }: { event?: EventSummary; rooms: Option[]; others: { name: string; sortOrder: number }[]; nextOrder: number; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const room = (ref: string) => rooms.find((r) => r.value === ref)?.label ?? '';
  const order = others.length ? `The others: ${others.map((o) => `${o.name} ${o.sortOrder}`).join(', ')}.` : '';
  const steps: FlowStep<EventValues>[] = [
    {
      title: 'What and when',
      fields: ['name', 'dateIso', 'startsAt', 'endsAt'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="name" label="Name" hint="As guests read it: “Welcome drinks”, “Ceremony”." />
          <TextField ctx={ctx} name="dateIso" label="Date" type="date" />
          <TextField ctx={ctx} name="startsAt" label="Starts" type="datetime-local" optional hint={CHICAGO_HINT} />
          <TextField ctx={ctx} name="endsAt" label="Ends" type="datetime-local" optional hint={CHICAGO_HINT} />
        </>
      ),
      ready: (v) => v.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(v.dateIso),
      readyHint: { field: 'name', message: 'Give the event a name (two letters or more) and a date.' },
    },
    {
      title: 'Where, and what to know',
      fields: ['venueSpaceRef', 'dressCode', 'description', 'accessibilityNote'],
      render: (ctx) => (
        <>
          <SelectField ctx={ctx} name="venueSpaceRef" label="Room" options={rooms} placeholder="Not confirmed yet" />
          <TextField ctx={ctx} name="dressCode" label="Dress code" optional />
          <TextField ctx={ctx} name="description" label="What happens" multiline optional />
          <TextField ctx={ctx} name="accessibilityNote" label="Accessibility note" multiline optional hint="Steps, distances, seating, hearing loops: what a guest needs to know before they come." />
        </>
      ),
    },
    {
      title: 'On the site',
      fields: ['placeholder', 'rsvpRequired', 'sortOrder'],
      render: (ctx) => (
        <>
          <CheckField ctx={ctx} name="placeholder" label="Details not confirmed yet" hint="Guests see the event marked as still to be confirmed." />
          <CheckField ctx={ctx} name="rsvpRequired" label="Guests RSVP to this event" />
          <TextField ctx={ctx} name="sortOrder" label="Position in lists" type="number" min={0} max={1000} inputMode="numeric" hint={`Events are listed from the lowest number up. ${order}`} />
        </>
      ),
      ready: (v) => validOrder(v.sortOrder),
      readyHint: { field: 'sortOrder', message: 'Enter a whole number from 0 to 1000.' },
    },
    {
      title: 'Check and save',
      render: (ctx) => {
        const v = ctx.values;
        const starts = chicagoLocalToIso(v.startsAt);
        return (
          <ReviewList
            items={[
              { label: 'Name', value: v.name.trim() },
              { label: 'Date', value: v.dateIso ? formatEventDate(v.dateIso, TZ) : '' },
              { label: 'Time', value: starts ? formatEventWindow(starts, chicagoLocalToIso(v.endsAt), TZ) : '' },
              { label: 'Room', value: room(v.venueSpaceRef) },
              { label: 'Dress code', value: v.dressCode.trim() },
              { label: 'What happens', value: v.description.trim() },
              { label: 'Accessibility', value: v.accessibilityNote.trim() },
              { label: 'On the site', value: `${v.placeholder ? 'Marked as not confirmed yet' : 'Confirmed'}; ${v.rsvpRequired ? 'guests RSVP' : 'no RSVP'}` },
            ]}
          />
        );
      },
    },
  ];

  return (
    <AdminFlow<EventValues>
      id={`events:event:${event?.id ?? 'new'}`}
      title={event ? `Edit ${event.name}` : 'Add an event'}
      trigger={{ label, variant, accessibleName: event ? `Edit ${event.name}` : undefined }}
      initial={eventValues(event, nextOrder)}
      // The page refreshes after a save; reading the props again keeps the next edit current.
      load={event ? async () => eventValues(event, nextOrder) : undefined}
      steps={steps}
      submit={{
        label: event ? 'Save event' : 'Add event',
        capability: 'admin_upsert_event',
        success: event ? `${event.name} saved.` : 'Event added.',
        input: (v) => ({
          id: event?.id,
          name: v.name.trim(),
          description: v.description.trim() || null,
          dateIso: v.dateIso,
          startsAt: chicagoLocalToIso(v.startsAt),
          endsAt: chicagoLocalToIso(v.endsAt),
          venueSpaceRef: v.venueSpaceRef || null,
          dressCode: v.dressCode.trim() || null,
          accessibilityNote: v.accessibilityNote.trim() || null,
          placeholder: v.placeholder,
          rsvpRequired: v.rsvpRequired,
          sortOrder: Number(v.sortOrder),
        }),
      }}
    />
  );
}

/* ---------------------------------------------------------------- menu -------------------- */

type MenuOption = { label: string; description: string };

interface MenuValues extends Record<string, unknown> {
  options: MenuOption[];
}

const MAX_OPTIONS = 20;

/** The menu's choices as rows of two fields, with Add and Remove. Not in the kit: it edits a list. */
function MenuEditor({ ctx }: { ctx: FlowContext<MenuValues> }) {
  const opts = ctx.values.options;
  const update = (i: number, patch: Partial<MenuOption>) => ctx.set({ options: opts.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const error = ctx.errors.options;
  return (
    <>
      {opts.length === 0 ? <p className="flow-copy">No choices: guests are not asked about a meal for this event.</p> : null}
      {opts.map((o, i) => (
        <fieldset key={i} className="flow-choices">
          <legend className="flow-label">Choice {i + 1}</legend>
          <div className="flow-field">
            <label htmlFor={`${ctx.uid}-options-${i}-label`} className="flow-label">
              Name
            </label>
            <input id={`${ctx.uid}-options-${i}-label`} className="ops-input flow-input" value={o.label} autoComplete="off" onChange={(e) => update(i, { label: e.target.value })} />
          </div>
          <div className="flow-field">
            <label htmlFor={`${ctx.uid}-options-${i}-description`} className="flow-label">
              Description<span className="flow-optional"> (optional)</span>
            </label>
            <input id={`${ctx.uid}-options-${i}-description`} className="ops-input flow-input" value={o.description} autoComplete="off" onChange={(e) => update(i, { description: e.target.value })} />
          </div>
          <div>
            <button type="button" className="flow-trigger-quiet flow-trigger-danger" aria-label={`Remove choice ${i + 1}${o.label ? `, ${o.label}` : ''}`} onClick={() => ctx.set({ options: opts.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        </fieldset>
      ))}
      {opts.length < MAX_OPTIONS ? (
        <div>
          <button type="button" className="ops-button ops-button-ghost" onClick={() => ctx.set({ options: [...opts, { label: '', description: '' }] })}>
            Add a choice
          </button>
        </div>
      ) : (
        <p className="flow-hint">That is the most a menu can have ({MAX_OPTIONS}).</p>
      )}
      {error ? (
        <p id={`${ctx.uid}-options`} className="flow-field-error" tabIndex={-1}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * Publish a new menu version for one event. A menu is never edited in place: guests who chose from
 * the old version keep their answer on record and are asked to choose again, so the last step says
 * so before anything is published.
 */
export function MenuFlow({ event }: { event: EventSummary }) {
  const from = (): MenuValues => ({ options: event.mealOptions.map((m) => ({ label: m.label, description: m.description ?? '' })) });
  const next = event.mealOptionsVersion + 1;
  return (
    <AdminFlow<MenuValues>
      id={`events:menu:${event.id}`}
      title={`Menu for ${event.name}`}
      trigger={{ label: 'Menu', variant: 'quiet', accessibleName: `Menu for ${event.name}` }}
      initial={from()}
      load={async () => from()}
      steps={[
        {
          title: 'The choices',
          lede: 'What guests choose from, in the order they see it.',
          fields: ['options'],
          render: (ctx) => <MenuEditor ctx={ctx} />,
          ready: (v) => v.options.every((o) => o.label.trim().length > 0),
          readyHint: { field: 'options', message: 'Every choice needs a name. Remove the ones you do not want.' },
        },
        {
          title: `Publish version ${next}`,
          render: (ctx) => {
            const opts = ctx.values.options;
            return (
              <>
                <GuestPreview label="What guests choose from">
                  {opts.length ? (
                    <ul>
                      {opts.map((o, i) => (
                        <li key={i}>
                          <strong>{o.label.trim()}</strong>
                          {o.description.trim() ? `: ${o.description.trim()}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No meal choice for this event.</p>
                  )}
                </GuestPreview>
                {event.mealOptionsVersion > 0 ? (
                  <Consequences>
                    <p>
                      This replaces menu version {event.mealOptionsVersion}. Anyone who already chose from it keeps that answer on record, marked “menu changed”, and is asked to choose
                      again.
                    </p>
                  </Consequences>
                ) : null}
              </>
            );
          },
        },
      ]}
      submit={{
        label: `Publish version ${next}`,
        capability: 'admin_set_meal_options',
        success: `Menu version ${next} published for ${event.name}.`,
        input: (v) => ({ eventId: event.id, options: v.options.map((o) => ({ label: o.label.trim(), description: o.description.trim() || null })) }),
      }}
    />
  );
}

/* --------------------------------------------------------- invitations -------------------- */

export type Policy = 'no' | 'none' | 'named' | 'unnamed';

const POLICIES: { value: Policy; label: string }[] = [
  { value: 'no', label: 'Not invited' },
  { value: 'none', label: 'Invited' },
  { value: 'named', label: 'Invited, with a named guest' },
  { value: 'unnamed', label: 'Invited, with a guest' },
];
const policyLabel = (p: string) => POLICIES.find((x) => x.value === p)?.label ?? p;

export interface InviteeSummary {
  guestId: string;
  displayName: string;
  householdName: string;
  isMinor: boolean;
}

interface InviteValues extends Record<string, unknown> {
  q: string;
  cells: Record<string, Policy>;
}

/** The capability's per-call cap (`changes.max(500)` in admin_events.ts). */
const ENTITLEMENT_CHUNK = 500;

/**
 * Who is invited to one event, and whether they may bring someone.
 *
 * This was a guest × event grid of selects: at 390px a table scrolling sideways past every event
 * to reach one cell. It is now one flow per event: every guest by household, a search to find one,
 * and the changes read back before anything is saved. Only the cells that changed are sent, in
 * chunks under the capability's cap, as the old server action did.
 */
export function InvitationsFlow({ event, guests, current }: { event: { id: string; name: string }; guests: InviteeSummary[]; current: Record<string, Policy> }) {
  const base = (): InviteValues => ({ q: '', cells: Object.fromEntries(guests.map((g) => [g.guestId, current[g.guestId] ?? 'no'])) });
  const changes = (v: InviteValues) => guests.filter((g) => (v.cells[g.guestId] ?? 'no') !== (current[g.guestId] ?? 'no'));
  const households = [...new Set(guests.map((g) => g.householdName))];

  const run = async (v: InviteValues): Promise<CapabilityResponse> => {
    const list = changes(v).map((g) => {
      const p = v.cells[g.guestId] ?? 'no';
      return p === 'no' ? { guestId: g.guestId, eventId: event.id, invited: false } : { guestId: g.guestId, eventId: event.id, invited: true, plusOnePolicy: p };
    });
    let applied = 0;
    let last: CapabilityResponse = { ok: true, data: { applied: 0 } };
    for (let at = 0; at < list.length; at += ENTITLEMENT_CHUNK) {
      last = await callCapability<{ applied: number }>('admin_set_event_entitlements', { input: { changes: list.slice(at, at + ENTITLEMENT_CHUNK) }, idempotencyKey: newIdempotencyKey() });
      if (!last.ok) {
        return applied ? { ...last, error: { code: last.error?.code ?? 'internal', message: `Saved ${applied} changes, then: ${last.error?.message ?? 'the rest did not save.'}` } } : last;
      }
      applied += (last.data as { applied: number }).applied;
    }
    return { ...last, data: { applied } };
  };

  return (
    <AdminFlow<InviteValues>
      id={`events:invitations:${event.id}`}
      title={`Who is invited to ${event.name}`}
      trigger={{ label: 'Invitations', variant: 'quiet', accessibleName: `Who is invited to ${event.name}` }}
      initial={base()}
      load={async () => base()}
      steps={[
        {
          title: 'Choose who is invited',
          lede: 'A guest can be invited alone, with a guest they name, or with a guest they do not have to name.',
          fields: ['cells'],
          render: (ctx) => {
            const q = ctx.values.q.trim().toLowerCase();
            const shown = (name: string, hh: string) => !q || name.toLowerCase().includes(q) || hh.toLowerCase().includes(q);
            const invited = guests.filter((g) => (ctx.values.cells[g.guestId] ?? 'no') !== 'no').length;
            const groups = households.map((hh) => ({ hh, members: guests.filter((g) => g.householdName === hh && shown(g.displayName, hh)) })).filter((x) => x.members.length);
            return (
              <>
                <p className="flow-copy">
                  {invited} of {guests.length} guests invited. {changes(ctx.values).length ? `${changes(ctx.values).length} changed so far.` : ''}
                </p>
                <TextField ctx={ctx} name="q" label="Find a guest or household" optional />
                {groups.length === 0 ? <p className="flow-hint">Nobody matches that search.</p> : null}
                {groups.map(({ hh, members }) => (
                  <fieldset key={hh} className="flow-choices">
                    <legend className="flow-label">{hh}</legend>
                    {members.map((g) => {
                      const id = `${ctx.uid}-cell-${g.guestId}`;
                      return (
                        <div key={g.guestId} className="flow-field">
                          <label htmlFor={id} className="flow-label">
                            {g.displayName}
                            {g.isMinor ? <span className="flow-optional"> (a child)</span> : null}
                          </label>
                          <select id={id} className="ops-input flow-input" value={ctx.values.cells[g.guestId] ?? 'no'} onChange={(e) => ctx.set({ cells: { ...ctx.values.cells, [g.guestId]: e.target.value as Policy } })}>
                            {POLICIES.map((p) => (
                              <option key={p.value} value={p.value}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </fieldset>
                ))}
              </>
            );
          },
          ready: (v) => changes(v).length > 0,
          readyHint: { message: 'Nothing has changed yet: choose a different invitation for someone first.' },
        },
        {
          title: 'Check and save',
          render: (ctx) => {
            const changed = changes(ctx.values);
            const removed = changed.filter((g) => ctx.values.cells[g.guestId] === 'no');
            return (
              <>
                <ReviewList items={changed.map((g) => ({ label: `${g.displayName} (${g.householdName})`, value: `${policyLabel(current[g.guestId] ?? 'no')} → ${policyLabel(ctx.values.cells[g.guestId] ?? 'no')}` }))} />
                {removed.length ? (
                  <Consequences>
                    <p>
                      {removed.length === 1 ? `${removed[0]!.displayName} is` : `${removed.length} guests are`} taken off {event.name}: it leaves their RSVP and their weekend
                      page. You can invite them again later.
                    </p>
                  </Consequences>
                ) : null}
              </>
            );
          },
        },
      ]}
      submit={{
        label: 'Save invitations',
        run,
        success: `Invitations to ${event.name} saved.`,
      }}
    />
  );
}

/* --------------------------------------------------------- rsvp window -------------------- */

interface WindowValues extends Record<string, unknown> {
  mode: string;
  deadlineAt: string;
  note: string;
}

const MODES = [
  { value: 'auto', label: 'Automatic', description: 'Open while the site is in its RSVP stage, until the deadline.' },
  { value: 'open', label: 'Open now', description: 'Guests can answer, whatever the schedule says.' },
  { value: 'closed', label: 'Closed now', description: 'Guests can read their answers but not change them.' },
];

/** When guests can answer. Manual open or closed beats the schedule. */
export function WindowFlow({ settings }: { settings: { mode: string; deadlineAt: string | null; note: string | null } }) {
  const from = (): WindowValues => ({ mode: settings.mode, deadlineAt: isoToChicagoLocal(settings.deadlineAt), note: settings.note ?? '' });
  return (
    <AdminFlow<WindowValues>
      id="events:window"
      title="Change the RSVP window"
      trigger={{ label: 'Change the RSVP window', variant: 'ghost' }}
      initial={from()}
      load={async () => from()}
      steps={[
        {
          title: 'When can guests answer?',
          fields: ['mode'],
          render: (ctx) => <ChoiceField ctx={ctx} name="mode" legend="RSVPs are" choices={MODES} />,
        },
        {
          title: 'Deadline and note',
          fields: ['deadlineAt', 'note'],
          render: (ctx) => (
            <>
              <TextField ctx={ctx} name="deadlineAt" label="Deadline" type="datetime-local" optional hint="Chicago time. Guests see it on the RSVP. Leave it empty until Tyler & Sara have chosen it." />
              <TextField ctx={ctx} name="note" label="Note to yourselves" optional hint="Never shown to guests." />
            </>
          ),
        },
        {
          title: 'Check and save',
          render: (ctx) => {
            const deadline = chicagoLocalToIso(ctx.values.deadlineAt);
            return (
              <ReviewList
                items={[
                  { label: 'RSVPs are', value: MODES.find((m) => m.value === ctx.values.mode)?.label ?? ctx.values.mode },
                  { label: 'Deadline', value: deadline ? formatDeadline(deadline) : '' },
                  { label: 'Note', value: ctx.values.note.trim() },
                ]}
              />
            );
          },
        },
      ]}
      submit={{
        label: 'Save RSVP window',
        capability: 'admin_set_rsvp_window',
        success: 'RSVP window saved.',
        input: (v) => ({ mode: v.mode, deadlineAt: chicagoLocalToIso(v.deadlineAt), note: v.note.trim() || null }),
      }}
    />
  );
}

/* ------------------------------------------------------------- notices -------------------- */

export interface NoticeSummary {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'urgent';
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

interface NoticeValues extends Record<string, unknown> {
  title: string;
  body: string;
  severity: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
}

const noticeValues = (n?: NoticeSummary): NoticeValues => ({
  title: n?.title ?? '',
  body: n?.body ?? '',
  severity: n?.severity ?? 'info',
  active: n ? n.active : true,
  startsAt: isoToChicagoLocal(n?.startsAt),
  endsAt: isoToChicagoLocal(n?.endsAt),
});

const SEVERITIES = [
  { value: 'info', label: 'Information', description: 'A change of plan, a reminder.' },
  { value: 'urgent', label: 'Urgent', description: 'Shown first, marked urgent. For weather, a closed road, a new time.' },
];

/** Post a notice on Your Weekend, or edit one: the message, when it shows, then how guests see it. */
export function NoticeFlow({ notice, label, variant = 'ghost' }: { notice?: NoticeSummary; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const when = (v: NoticeValues) => {
    const s = chicagoLocalToIso(v.startsAt);
    const e = chicagoLocalToIso(v.endsAt);
    if (!v.active) return 'Hidden from guests';
    if (!s && !e) return 'Shown now, until you hide it';
    return [s ? `From ${formatDeadline(s)}` : 'From now', e ? `until ${formatDeadline(e)}` : 'until you hide it'].join(' ');
  };
  return (
    <AdminFlow<NoticeValues>
      id={`events:notice:${notice?.id ?? 'new'}`}
      title={notice ? `Edit “${notice.title}”` : 'Post a notice'}
      trigger={{ label, variant, accessibleName: notice ? `Edit notice “${notice.title}”` : undefined }}
      initial={noticeValues(notice)}
      load={notice ? async () => noticeValues(notice) : undefined}
      steps={[
        {
          title: 'The message',
          fields: ['title', 'body', 'severity'],
          render: (ctx) => (
            <>
              <TextField ctx={ctx} name="title" label="Title" />
              <TextField ctx={ctx} name="body" label="Message" multiline />
              <ChoiceField ctx={ctx} name="severity" legend="Kind" choices={SEVERITIES} />
            </>
          ),
          ready: (v) => v.title.trim().length >= 2 && v.body.trim().length >= 2,
          readyHint: { field: 'title', message: 'Write a title and a message.' },
        },
        {
          title: 'When it shows',
          fields: ['active', 'startsAt', 'endsAt'],
          render: (ctx) => (
            <>
              <CheckField ctx={ctx} name="active" label="Show this notice" hint="Untick to keep it saved but hidden." />
              <TextField ctx={ctx} name="startsAt" label="Show from" type="datetime-local" optional hint="Chicago time. Empty: from now." />
              <TextField ctx={ctx} name="endsAt" label="Show until" type="datetime-local" optional hint="Chicago time. Empty: until you hide it." />
            </>
          ),
        },
        {
          title: 'Check and post',
          render: (ctx) => (
            <>
              <GuestPreview label="What guests will see on Your Weekend">
                <p>
                  {ctx.values.severity === 'urgent' ? <strong>Urgent: </strong> : null}
                  <strong>{ctx.values.title.trim()}</strong>
                </p>
                {ctx.values.body
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
              </GuestPreview>
              <ReviewList items={[{ label: 'When', value: when(ctx.values) }]} />
            </>
          ),
        },
      ]}
      submit={{
        label: notice ? 'Save notice' : 'Post notice',
        capability: 'admin_upsert_notice',
        success: notice ? 'Notice saved.' : 'Notice posted.',
        input: (v) => ({ id: notice?.id, title: v.title.trim(), body: v.body.trim(), severity: v.severity, active: v.active, startsAt: chicagoLocalToIso(v.startsAt), endsAt: chicagoLocalToIso(v.endsAt) }),
      }}
    />
  );
}
