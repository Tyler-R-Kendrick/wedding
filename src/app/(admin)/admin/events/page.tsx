import type { Metadata } from 'next';
import { adminListEvents } from '@/capabilities/rsvp';
import { moveCalls } from '@/components/admin/flow/order';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { agendaDays, undecided } from '@/domain/events/agenda';
import { formatDeadline, formatEventDate, formatEventWindow } from '@/domain/events/format';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Note, Pill, Section } from '../_components/console';
import { DeleteEventFlow, DeleteNoticeFlow, EventFlow, InvitationsFlow, MenuFlow, NoticeFlow, WindowFlow, type Policy } from './_components/EventFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Schedule', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const MODE: Record<string, string> = { auto: 'Automatic', open: 'Open now', closed: 'Closed now' };
const CELL: Record<string, string> = { none: 'Invited', named: 'Invited + named guest', unnamed: 'Invited + guest' };

type Ordered = { id: string; sortOrder: number };
/**
 * Up/Down for an event: `moveCalls`'s saves (this event and its neighbour, or the whole list when
 * two share a place) sent as one `admin_reorder_events` call, so they land together or not at all.
 */
const move = (list: readonly Ordered[], index: number, direction: 'up' | 'down') => {
  const moves = moveCalls(list, index, direction, (r, p) => ({ id: r.id, sortOrder: p.sortOrder }), 'admin_reorder_events');
  return moves.length ? [{ capability: 'admin_reorder_events', input: { moves: moves.map((c) => c.input) } }] : [];
};

/**
 * Events, menus, invitations, notices and the RSVP window.
 *
 * Every change here is a flow from the admin kit (`components/admin/flow/CONVENTIONS.md`): adding or
 * editing an event, publishing a menu version, who is invited to each event, the RSVP window and
 * Your Weekend notices; deleting an event or a notice is a danger flow, and Up/Down on an event is a
 * `QuickAction`. They replace a long form per event and per notice (plus a blank one at the
 * end of each list), a textarea of `Label | description` lines, and a guest × event grid of selects
 * that scrolled sideways on a phone.
 */
export default async function AdminEventsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The schedule" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };
  const r = await adminInvoke(adminListEvents, {});
  if (!r.ok) {
    return (
      <ConsolePage title="Schedule" notice={notice}>
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const d = r.value.data;
  const rooms = d.venueSpaces.map((s) => ({ value: s.ref, label: s.name }));
  const roomName = (ref: string | null) => (ref ? (rooms.find((x) => x.value === ref)?.label ?? ref) : null);
  const guests = d.guests.map((g) => ({ guestId: g.guestId, displayName: g.displayName, householdName: g.householdName, isMinor: g.isMinor }));
  const policyOf = (eventId: string): Record<string, Policy> => Object.fromEntries(d.entitlements.filter((en) => en.eventId === eventId).map((en) => [en.guestId, en.plusOnePolicy]));
  const cell = (guestId: string, eventId: string) => d.entitlements.find((en) => en.guestId === guestId && en.eventId === eventId);

  return (
    <ConsolePage
      title="Schedule"
      lede="The weekend’s events day by day, what guests choose to eat, who is invited to what, when they can answer, and the notices on their dashboard."
      notice={notice}
      actions={<EventFlow rooms={rooms} label="Add an event" />}
    >
      <Section title="The weekend, day by day" id="events" note="Each day in the order things happen. An event with no time yet follows the timed ones; Up and Down set the order among those.">
        {d.events.length === 0 ? <p className="flow-empty">No events yet. Add the first one.</p> : null}
        {agendaDays(d.events).map((day) => (
          <div key={day.dateIso} className="ag-day">
            <h3 className="ag-day__title">
              {formatEventDate(day.dateIso, WEDDING_TIMEZONE)}
              <span className="ag-day__count">
                {day.timed.length + day.untimed.length} {day.timed.length + day.untimed.length === 1 ? 'event' : 'events'}
              </span>
            </h3>
            <ol className="ag-list">
              {[...day.timed, ...day.untimed].map((e) => {
                const loose = day.untimed.indexOf(e);
                const open = undecided(e);
                return (
                  <li key={e.id} className="ag-row" data-event-id={e.id}>
                    <p className={e.startsAt ? 'ag-row__time' : 'ag-row__time ag-row__time--unset'}>{e.startsAt ? formatEventWindow(e.startsAt, e.endsAt, e.timezone) : 'Time not set'}</p>
                    <div className="ag-row__body">
                      <p className="ag-row__name">
                        {e.name} {e.rsvpRequired ? null : <Pill>No RSVP</Pill>}
                      </p>
                      <p className="ag-row__meta">
                        {roomName(e.venueSpaceRef) ?? 'Room not set'} · {e.invitedCount} invited · {e.mealOptions.length ? `menu version ${e.mealOptionsVersion}, ${e.mealOptions.length} choices` : 'no meal choice'}
                      </p>
                      {open.length || e.placeholder ? (
                        <p className="ag-row__open">
                          <Pill tone="warn">{open.length ? 'To decide' : 'Marked not confirmed'}</Pill> {open.length ? open.join(', ') : 'Guests read these details as not final.'}
                        </p>
                      ) : null}
                      {e.responseCount > 0 ? (
                        <p className="ag-row__meta" data-testid="event-kept">
                          {e.responseCount === 1 ? 'One guest has' : `${e.responseCount} guests have`} answered its RSVP, so it cannot be deleted. Edit it instead.
                        </p>
                      ) : d.events.length === 1 ? (
                        <p className="ag-row__meta" data-testid="event-kept">
                          It is the only event, so it cannot be deleted: a wedding has at least one. Edit it instead.
                        </p>
                      ) : null}
                    </div>
                    <div className="ag-row__actions">
                      <EventFlow event={e} rooms={rooms} label="Edit" variant="quiet" />
                      <MenuFlow event={e} />
                      <InvitationsFlow event={{ id: e.id, name: e.name }} guests={guests} current={policyOf(e.id)} />
                      {loose >= 0 && day.untimed.length > 1 ? (
                        <>
                          <QuickAction label="Up" busyLabel="Moving…" done={`Moved ${e.name} up.`} unavailable={loose === 0} accessibleName={`Move ${e.name} up`} calls={move(d.events, d.events.indexOf(e), 'up')} />
                          <QuickAction label="Down" busyLabel="Moving…" done={`Moved ${e.name} down.`} unavailable={loose === day.untimed.length - 1} accessibleName={`Move ${e.name} down`} calls={move(d.events, d.events.indexOf(e), 'down')} />
                        </>
                      ) : null}
                      {e.responseCount === 0 && d.events.length > 1 ? <DeleteEventFlow event={{ id: e.id, name: e.name, invitedCount: e.invitedCount, mealOptionsVersion: e.mealOptionsVersion }} /> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </Section>

      <Section title="RSVP window" id="window">
        <p className="flow-copy">
          RSVPs are <strong>{d.window.open ? 'open' : 'closed'}</strong> right now. Setting: {MODE[d.settings.mode] ?? d.settings.mode}
          {d.settings.deadlineAt ? `; deadline ${formatDeadline(d.settings.deadlineAt)}` : '; no deadline set yet'}. Open or closed by hand beats the schedule.
        </p>
        <WindowFlow settings={d.settings} />
      </Section>


      <Section title="Who is invited to what" id="entitlements" note="To change it, use Invitations on the event above.">
        <DataTable
          caption="Invitations per guest and event"
          empty={d.guests.length === 0 ? <>No guests yet.</> : d.events.length === 0 ? <>No events yet.</> : null}
          head={
            <tr>
              <th scope="col">Guest</th>
              {d.events.map((e) => (
                <th key={e.id} scope="col">
                  {e.name}
                </th>
              ))}
            </tr>
          }
        >
          {d.guests.map((g) => (
            <tr key={g.guestId}>
              <th scope="row">
                {g.displayName}
                <br />
                <span className="con-index__blurb">
                  {g.householdName}
                  {g.isMinor ? ' · child' : ''}
                </span>
              </th>
              {d.events.map((e) => {
                const c = cell(g.guestId, e.id);
                return <td key={e.id}>{c ? CELL[c.plusOnePolicy] : '—'}</td>;
              })}
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Dashboard notices" id="notices" note="Shown to signed-in guests on their dashboard, urgent ones first.">
        <RecordList label="Notices" empty={d.notices.length === 0 ? 'No notices yet.' : null}>
          {d.notices.map((n) => (
            <RecordRow
              key={n.id}
              data-notice-id={n.id}
              title={n.title}
              status={
                <>
                  {n.severity === 'urgent' ? <Pill tone="warn">Urgent</Pill> : null}
                  {n.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>}
                </>
              }
              meta={
                <>
                  {n.startsAt ? `From ${formatDeadline(n.startsAt)}` : 'From now'}
                  {n.endsAt ? ` until ${formatDeadline(n.endsAt)}` : ''}
                </>
              }
              actions={
                <>
                  <NoticeFlow notice={n} label="Edit" variant="quiet" />
                  <QuickAction
                    label={n.active ? 'Hide' : 'Show'}
                    busyLabel={n.active ? 'Hiding…' : 'Showing…'}
                    done={n.active ? `${n.title} hidden.` : `${n.title} shown.`}
                    accessibleName={`${n.active ? 'Hide' : 'Show'} ${n.title}`}
                    calls={[{ capability: 'admin_upsert_notice', input: { id: n.id, title: n.title, body: n.body, severity: n.severity, active: !n.active, startsAt: n.startsAt, endsAt: n.endsAt } }]}
                  />
                  <DeleteNoticeFlow notice={{ id: n.id, title: n.title, active: n.active }} />
                </>
              }
            />
          ))}
        </RecordList>
        <NoticeFlow label="Post a notice" />
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>
            RSVP window: {d.window.reason.replace('_', ' ')}; lifecycle {d.window.lifecycle}
            {d.settings.note ? `; note: ${d.settings.note}` : ''}.
          </Note>
          <DataTable
            caption="Events and every menu version"
            empty={d.events.length ? null : 'No events.'}
            head={
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Id</th>
                <th scope="col">Position</th>
                <th scope="col">Menu versions</th>
              </tr>
            }
          >
            {d.events.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.name}</th>
                <td>{e.id}</td>
                <td>{e.sortOrder}</td>
                <td className="con-wrap">{e.allVersions.length ? e.allVersions.map((v) => `v${v.version} ${v.label}`).join(', ') : '—'}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
