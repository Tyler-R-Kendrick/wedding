import type { Metadata } from 'next';
import { adminExportNeeds, adminListEvents, adminRsvpOverview, type AdminRsvpOverview } from '@/capabilities/rsvp';
import { FilterBar } from '@/components/admin/flow/records';
import { LIFECYCLE_ORDER } from '@/contracts/lifecycle';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Day, Denied, KeyValues, Note, Pill, Section, Stat, StatStrip } from '../_components/console';
import { Checkbox, Input } from '../_components/ops';
import { stateLabel } from '@/domain/lifecycle/words';
import { ANSWER_FILTERS, answerWords } from './_components/answers';
import { CorrectAnswer, RecordAnswerFlow, type AnswerSlot, type MenuSummary } from './_components/RsvpFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVPs (admin)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Whether guests can answer, and why, in a sentence. The window's reason codes stay out of it. */
function windowSentence(w: AdminRsvpOverview['window']): string {
  switch (w.reason) {
    case 'manual_open':
      return 'Guests can answer now: replies were opened by hand, which beats the schedule.';
    case 'manual_closed':
      return 'Guests cannot answer: replies were closed by hand.';
    case 'deadline_passed':
      return 'Guests can no longer answer: the deadline has passed.';
    case 'scheduled':
      return w.deadlineAt ? 'Guests can answer now, until the deadline.' : 'Guests can answer now. No deadline is set yet.';
    case 'lifecycle':
      return LIFECYCLE_ORDER[w.lifecycle] < LIFECYCLE_ORDER.RSVP_OPEN
        ? `Guests cannot answer yet: the site is at ${stateLabel(w.lifecycle)}, and replies open at RSVPs open.`
        : `Guests can no longer answer: the site has moved on to ${stateLabel(w.lifecycle)}.`;
  }
}

/**
 * RSVPs, on the admin console shell.
 *
 * This screen rendered in the GUEST kit — `page`, `sec`, `card`, `stat`, `tbl` from
 * `components/rsvp/recipes.css`, and the guest RSVP form's own `Field`/`Select`/`ChoiceGroup`
 * widgets. It was the same information as `/admin/audit` next door, dressed as a guest page: a
 * different type scale, a different table, a different idea of what a section is. Everything below
 * is the console's, and the guest kit is no longer imported by any admin route.
 *
 * Recording or correcting an answer is a flow from the admin kit (`components/admin/flow/
 * CONVENTIONS.md`): the one primary action at the top, or a row's Correct with the guest and event
 * already chosen. Exports and the audited notes are links and a filter, not header buttons.
 */
export default async function AdminRsvpPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="RSVPs" />;
  const sp = await searchParams;
  // `on` from the filter's checkbox; `1` from older links.
  const showNeeds = ['1', 'on'].includes(one(sp.needs) ?? '');
  const eventFilter = one(sp.event) ?? '';
  const answerFilter = one(sp.answer) ?? '';
  const notice = { ok: one(sp.ok), error: one(sp.error) };

  const [overview, events] = await Promise.all([adminInvoke(adminRsvpOverview, {}), adminInvoke(adminListEvents, {})]);
  if (!overview.ok) {
    return (
      <ConsolePage title="RSVPs">
        <Denied message={overview.error.message} />
      </ConsolePage>
    );
  }
  const d = overview.value.data;
  const ev = events.ok ? events.value.data : null;
  // Sensitive: loaded only on explicit request (the capability call itself is the audit trail).
  const needs = showNeeds ? await adminInvoke(adminExportNeeds, { includeNeeds: true }) : null;
  const menus: MenuSummary[] = ev ? ev.events.map((e) => ({ eventId: e.id, options: e.mealOptions.map((m) => ({ id: m.id, label: m.label })) })) : [];

  // A row's correction carries only this guest's invitations and those events' menus, not the whole
  // screen's: hundreds of rows each holding every slot would be a page of repeated data.
  const slotsByGuest = new Map<string, AnswerSlot[]>();
  for (const r of d.rows) slotsByGuest.set(r.guestId, [...(slotsByGuest.get(r.guestId) ?? []), r]);
  const menusFor = (slots: AnswerSlot[]) => menus.filter((m) => slots.some((s) => s.eventId === m.eventId));

  const rows = d.rows
    .filter((r) => !eventFilter || r.eventId === eventFilter)
    .filter((r) => !answerFilter || (answerFilter === 'none' ? r.status === null : r.status === answerFilter))
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.eventName.localeCompare(b.eventName));
  const filtered = Boolean(eventFilter || answerFilter);

  return (
    <ConsolePage title="RSVPs" lede={windowSentence(d.window)} notice={notice} actions={ev ? <RecordAnswerFlow slots={d.rows} menus={menus} /> : null}>
      <KeyValues
        items={[
          { label: 'Replies', value: d.window.open ? 'Open' : 'Closed' },
          { label: 'Deadline', value: d.window.deadlineAt ? <Day at={d.window.deadlineAt} /> : 'Not set yet' },
          { label: 'Site stage', value: stateLabel(d.window.lifecycle) },
        ]}
      />
      <Note>
        The window and the deadline are set on <a href="/admin/events">Events</a>; the stage on <a href="/admin/lifecycle">Lifecycle</a>.
      </Note>

      <Section title="By event" id="counts">
        {d.events.map((e) => (
          <div key={e.id}>
            <h3 className="ops-h2">{e.name}</h3>
            <StatStrip>
              <Stat label="Invited" value={e.invited} />
              <Stat label="Coming" value={e.accepted} />
              <Stat label="Not coming" value={e.declined} />
              <Stat label="No answer yet" value={e.pending} />
              <Stat label="Plus-ones" value={e.plusOnes} />
              <Stat label="Stale meals" value={e.staleMeals} hint={e.staleMeals ? 'the menu changed after the answer' : 'nothing to re-ask'} />
            </StatStrip>
          </div>
        ))}
      </Section>

      <Section title="Every answer" id="rows" note="After a phone call or an email, use Correct on the guest’s row, or Record an answer at the top. Both work after the deadline and are audited with your reason.">
        <FilterBar
          submitLabel="Show"
          extra={
            <>
              <a href="/admin/rsvp/export">Export answers (CSV)</a>
              <a href="/admin/rsvp/export?needs=1">Export dietary and accessibility notes (CSV, audited)</a>
              {filtered || showNeeds ? <a href="/admin/rsvp">Show every answer</a> : null}
            </>
          }
        >
          <Input id="event" label="Event" defaultValue={eventFilter} options={[{ value: '', label: 'Every event' }, ...d.events.map((e) => ({ value: e.id, label: e.name }))]} />
          <Input id="answer" label="Answer" defaultValue={answerFilter} options={ANSWER_FILTERS.map((a) => ({ value: a.value, label: a.label }))} />
          <Checkbox id="needs" label="Show dietary and accessibility notes (audited)" defaultChecked={showNeeds} />
        </FilterBar>
        {/* Guest and answer first: at 390px the table scrolls sideways, and those are the two
            columns a person reads it for. */}
        <DataTable
          caption="Every RSVP answer"
          empty={rows.length === 0 ? (filtered ? <>No answer matches these filters.</> : <>Nobody has answered yet.</>) : null}
          head={
            <tr>
              <th scope="col">Guest</th>
              <th scope="col">Answer</th>
              <th scope="col">Event</th>
              <th scope="col">Household</th>
              <th scope="col">Meal</th>
              <th scope="col">Plus-one</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          }
        >
          {rows.map((r) => {
            const answer = answerWords(r.status);
            const guestSlots = slotsByGuest.get(r.guestId) ?? [r];
            return (
              <tr key={`${r.guestId}-${r.eventId}`}>
                <th scope="row">{r.displayName}</th>
                <td>
                  <Pill tone={answer.tone}>{answer.label}</Pill>
                </td>
                <td>{r.eventName}</td>
                <td>{r.householdName}</td>
                <td>
                  {r.mealLabel ?? '—'} {r.mealStale ? <Pill tone="warn">Menu changed</Pill> : null}
                </td>
                <td>{r.plusOnePolicy === 'none' ? '—' : r.plusOne?.attending ? `${r.plusOne.name ?? 'Name not given'}${r.plusOne.mealLabel ? ` (${r.plusOne.mealLabel})` : ''}` : 'Not bringing anyone'}</td>
                <td>
                  <Day at={r.updatedAt} /> {r.submittedVia === 'admin' ? <Pill tone="neutral">By an admin</Pill> : null}
                </td>
                <td>{ev ? <CorrectAnswer slots={guestSlots} menus={menusFor(guestSlots)} pick={{ guestId: r.guestId, eventId: r.eventId }} /> : null}</td>
              </tr>
            );
          })}
        </DataTable>
      </Section>

      {needs ? (
        <Section title="Dietary and accessibility notes" id="needs">
          {needs.ok ? (
            <DataTable
              caption="Dietary and accessibility notes"
              empty={needs.value.data.rows.length === 0 ? <>No notes recorded yet.</> : null}
              head={
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">Household</th>
                  <th scope="col">Dietary</th>
                  <th scope="col">Accessibility</th>
                </tr>
              }
            >
              {needs.value.data.rows.map((n) => (
                <tr key={n.guestId}>
                  <th scope="row">{n.displayName}</th>
                  <td>{n.householdName}</td>
                  <td className="con-wrap">{n.dietary ?? '—'}</td>
                  <td className="con-wrap">{n.accessibility ?? '—'}</td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <Denied message={needs.error.message} />
          )}
        </Section>
      ) : null}
    </ConsolePage>
  );
}
