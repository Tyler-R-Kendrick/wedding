import type { Metadata } from 'next';
import { adminExportNeeds, adminListEvents, adminRsvpOverview } from '@/capabilities/rsvp';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Pill, Section, Stamp, Stat, StatStrip } from '../_components/console';
import { Button, Checkbox, IdemKey, Input, Radios } from '../_components/ops';
import { overrideAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVPs (admin)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * RSVPs, on the admin console shell.
 *
 * This screen rendered in the GUEST kit — `page`, `sec`, `card`, `stat`, `tbl` from
 * `components/rsvp/recipes.css`, and the guest RSVP form's own `Field`/`Select`/`ChoiceGroup`
 * widgets. It was the same information as `/admin/audit` next door, dressed as a guest page: a
 * different type scale, a different table, a different idea of what a section is. Everything below
 * is the console's, and the guest kit is no longer imported by any admin route.
 */
export default async function AdminRsvpPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="RSVPs" />;
  const sp = await searchParams;
  const showNeeds = one(sp.needs) === '1';
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
  const meals = ev ? ev.events.flatMap((e) => e.mealOptions.map((m) => ({ value: m.id, label: `${e.name}: ${m.label}` }))) : [];

  return (
    <ConsolePage
      title="RSVPs"
      lede={`RSVPs are ${d.window.open ? 'open' : 'closed'} (${d.window.reason.replace('_', ' ')}).`}
      notice={notice}
      actions={
        <>
          <a className="ops-button ops-button-ghost" href="/admin/rsvp/export">
            RSVP CSV
          </a>
          <a className="ops-button ops-button-ghost" href="/admin/rsvp/export?needs=1">
            Dietary &amp; accessibility CSV (audited)
          </a>
          <a className="ops-button ops-button-ghost" href={showNeeds ? '/admin/rsvp' : '/admin/rsvp?needs=1'}>
            {showNeeds ? 'Hide notes' : <>Show dietary &amp; accessibility notes (audited)</>}
          </a>
        </>
      }
    >
      <Section title="By event" id="counts">
        {d.events.map((e) => (
          <div key={e.id}>
            <h3 className="ops-h2">{e.name}</h3>
            <StatStrip>
              <Stat label="Invited" value={e.invited} />
              <Stat label="Attending" value={e.accepted} />
              <Stat label="Declined" value={e.declined} />
              <Stat label="No answer" value={e.pending} />
              <Stat label="Plus-ones" value={e.plusOnes} />
              <Stat label="Stale meals" value={e.staleMeals} hint={e.staleMeals ? 'the menu changed after the answer' : 'nothing to re-ask'} />
            </StatStrip>
          </div>
        ))}
      </Section>

      {needs ? (
        <Section title="Dietary and accessibility notes" id="needs">
          {needs.ok ? (
            <DataTable
              caption="Dietary and accessibility notes"
              empty={needs.value.data.rows.length === 0 ? <>No notes recorded yet.</> : null}
              head={
                <tr>
                  <th scope="col">Household</th>
                  <th scope="col">Guest</th>
                  <th scope="col">Dietary</th>
                  <th scope="col">Accessibility</th>
                </tr>
              }
            >
              {needs.value.data.rows.map((n) => (
                <tr key={n.guestId}>
                  <th scope="row">{n.householdName}</th>
                  <td>{n.displayName}</td>
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

      <Section title="Every answer" id="rows">
        <DataTable
          caption="Every RSVP answer"
          empty={d.rows.length === 0 ? <>Nobody has answered yet.</> : null}
          head={
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Household</th>
              <th scope="col">Guest</th>
              <th scope="col">Answer</th>
              <th scope="col">Meal</th>
              <th scope="col">Plus-one</th>
              <th scope="col">Updated</th>
            </tr>
          }
        >
          {d.rows.map((r) => (
            <tr key={`${r.guestId}-${r.eventId}`}>
              <th scope="row">{r.eventName}</th>
              <td>{r.householdName}</td>
              <td>{r.displayName}</td>
              <td>
                {r.status === 'accepted' ? <Pill tone="good">attending</Pill> : r.status === 'declined' ? <Pill tone="bad">declined</Pill> : <Pill tone="neutral">no answer</Pill>}
              </td>
              <td>
                {r.mealLabel ?? '—'} {r.mealStale ? <Pill tone="warn">menu changed</Pill> : null}
              </td>
              <td>{r.plusOnePolicy === 'none' ? '—' : r.plusOne?.attending ? `${r.plusOne.name ?? 'unnamed'}${r.plusOne.mealLabel ? ` (${r.plusOne.mealLabel})` : ''}` : 'no'}</td>
              <td>
                <Stamp at={r.updatedAt} /> {r.submittedVia === 'admin' ? <Pill tone="neutral">by admin</Pill> : null}
              </td>
            </tr>
          ))}
        </DataTable>
      </Section>

      {ev ? (
        <Section title="Record or correct an answer" id="override" note="Use after a phone call or e-mail. Works after the deadline; audited with your reason.">
          <form action={overrideAction} className="ops-form">
            <IdemKey />
            <Input id="ov-guest" name="guestId" label="Guest" required options={ev.guests.map((g) => ({ value: g.guestId, label: `${g.displayName} (${g.householdName})` }))} />
            <Input id="ov-event" name="eventId" label="Event" required options={ev.events.map((e) => ({ value: e.id, label: e.name }))} />
            <Radios name="status" legend="Answer" options={[{ value: 'accepted', label: 'Attending', defaultChecked: true }, { value: 'declined', label: 'Not attending' }]} />
            <Input id="ov-meal" name="mealOptionId" label="Meal (current menu)" hint="Only for events with a menu." options={[{ value: '', label: 'No meal' }, ...meals]} />
            <Checkbox id="ov-p1" name="plusOne" label="Bringing a guest" />
            <Input id="ov-p1name" name="plusOneName" label="Guest's name" hint="Leave blank if nobody is coming with them." />
            <Input id="ov-p1meal" name="plusOneMealOptionId" label="Guest's meal" options={[{ value: '', label: 'No meal' }, ...meals]} />
            <Input id="ov-reason" name="reason" label="Reason (audited)" required hint="Recorded on the audit row with your identity." />
            <div className="ops-form-inline">
              <Button>Record answer</Button>
            </div>
          </form>
        </Section>
      ) : null}
    </ConsolePage>
  );
}
