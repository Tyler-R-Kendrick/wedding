import type { Metadata } from 'next';
import { adminListEvents } from '@/capabilities/rsvp';
import { isoToChicagoLocal } from '@/domain/events/format';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, Denied, Note, ScrollRegion, Section } from '../_components/console';
import { Button, Checkbox, IdemKey, Input, Radios } from '../_components/ops';
import { saveEntitlementsAction, saveEventAction, saveMealsAction, saveNoticeAction, saveWindowAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Events (admin)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Events, menus, invitations and the RSVP window — on the admin console shell.
 *
 * Every form here was built from `components/rsvp/fields`, the GUEST RSVP kit: `Field`, `Select`,
 * `Textarea`, `ChoiceGroup` and the `.card` / `.sec` / `.tbl` classes from the guest stylesheet.
 * The console's own primitives are what an operator meets everywhere else in `/admin`, so they are
 * what this screen uses now; the guest kit is no longer imported by any admin route.
 */
export default async function AdminEventsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Events and the RSVP window" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };
  const r = await adminInvoke(adminListEvents, {});
  if (!r.ok) {
    return (
      <ConsolePage title="Events, menu, invitations, RSVP window" notice={notice}>
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const d = r.value.data;
  return (
    <ConsolePage title="Events, menu, invitations, RSVP window" notice={notice}>
      <Section
        title="RSVP window"
        id="window"
        note={
          <>
            Right now RSVPs are <strong>{d.window.open ? 'open' : 'closed'}</strong> ({d.window.reason.replace('_', ' ')}; lifecycle {d.window.lifecycle}). Manual open/closed beats the schedule.
          </>
        }
      >
        <form action={saveWindowAction} className="ops-form">
          <IdemKey />
          <Radios
            name="mode"
            legend="Mode"
            options={[
              { value: 'auto', label: 'Automatic (open during RSVP_OPEN until the deadline)', defaultChecked: d.settings.mode === 'auto' },
              { value: 'open', label: 'Open now', defaultChecked: d.settings.mode === 'open' },
              { value: 'closed', label: 'Closed now', defaultChecked: d.settings.mode === 'closed' },
            ]}
          />
          <Input id="window-deadline" name="deadlineAt" label="Deadline (America/Chicago)" type="datetime-local" defaultValue={isoToChicagoLocal(d.settings.deadlineAt)} hint="Leave empty while TODO(Tyler &amp; Sara)." />
          <Input id="window-note" name="note" label="Note (internal)" defaultValue={d.settings.note ?? ''} />
          <div className="ops-form-inline">
            <Button>Save RSVP window</Button>
          </div>
        </form>
      </Section>

      <Section title="Events" id="events">
        {[...d.events, null].map((e, idx) => (
          <form key={e?.id ?? 'new'} action={saveEventAction} className="ops-form con-panel" aria-label={e ? `Edit ${e.name}` : 'Add an event'}>
            <IdemKey />
            {e ? <input type="hidden" name="id" value={e.id} /> : null}
            <h3>{e ? e.name : 'Add an event'}</h3>
            {e ? <Note>Invited: {e.invitedCount} · Menu version {e.mealOptionsVersion} ({e.mealOptions.length} options)</Note> : null}
            <Input id={`ev-${idx}-name`} name="name" label="Name" defaultValue={e?.name ?? ''} required />
            <Input id={`ev-${idx}-date`} name="dateIso" label="Date" type="date" defaultValue={e?.dateIso ?? '2027-07-17'} required />
            <Input id={`ev-${idx}-start`} name="startsAt" label="Starts (America/Chicago)" type="datetime-local" defaultValue={isoToChicagoLocal(e?.startsAt)} />
            <Input id={`ev-${idx}-end`} name="endsAt" label="Ends (America/Chicago)" type="datetime-local" defaultValue={isoToChicagoLocal(e?.endsAt)} />
            <Input id={`ev-${idx}-space`} name="venueSpaceRef" label="Room" defaultValue={e?.venueSpaceRef ?? ''} options={[{ value: '', label: 'Not confirmed' }, ...d.venueSpaces.map((s) => ({ value: s.ref, label: s.name }))]} />
            <Input id={`ev-${idx}-dress`} name="dressCode" label="Dress code" defaultValue={e?.dressCode ?? ''} />
            <Input id={`ev-${idx}-sort`} name="sortOrder" label="Order" type="number" defaultValue={String(e?.sortOrder ?? (idx + 1) * 10)} />
            <Input id={`ev-${idx}-desc`} name="description" label="What happens" type="textarea" defaultValue={e?.description ?? ''} />
            <Input id={`ev-${idx}-access`} name="accessibilityNote" label="Accessibility note" type="textarea" defaultValue={e?.accessibilityNote ?? ''} />
            <Checkbox id={`ev-${idx}-placeholder`} name="placeholder" label="Details not confirmed yet (shown as placeholder)" defaultChecked={e ? e.placeholder : true} />
            <Checkbox id={`ev-${idx}-rsvp`} name="rsvpRequired" label="Guests RSVP to this event" defaultChecked={e ? e.rsvpRequired : true} />
            <div className="ops-form-inline">
              <Button>{e ? 'Save event' : 'Add event'}</Button>
            </div>
          </form>
        ))}
      </Section>

      <Section title="Menus" id="menus">
        {d.events.map((e) => (
          <form key={e.id} action={saveMealsAction} className="ops-form con-panel" aria-label={`Menu for ${e.name}`}>
            <IdemKey />
            <input type="hidden" name="eventId" value={e.id} />
            <h3>
              {e.name} — publish menu version {e.mealOptionsVersion + 1}
            </h3>
            <Input
              id={`menu-${e.id}`}
              name="options"
              label="One option per line"
              type="textarea"
              hint="Format: Label | short description. Empty = no meal choice for this event. Guests who chose from an older version are asked to choose again."
              defaultValue={e.mealOptions.map((m) => (m.description ? `${m.label} | ${m.description}` : m.label)).join('\n')}
            />
            <div className="ops-form-inline">
              <Button variant="ghost">Publish new menu version</Button>
            </div>
          </form>
        ))}
      </Section>

      <Section title="Who is invited to what" id="entitlements">
        <form action={saveEntitlementsAction}>
          <IdemKey />
          <ScrollRegion scrollable={d.guests.length > 0}>
            <table className="ops-table con-table">
              <caption className="con-caption">Invitations per guest and event</caption>
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  {d.events.map((e) => (
                    <th key={e.id} scope="col">
                      {e.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
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
                      const current = d.entitlements.find((en) => en.guestId === g.guestId && en.eventId === e.id);
                      const id = `ent-${g.guestId}-${e.id}`;
                      return (
                        <td key={e.id}>
                          <label className="sr-only" htmlFor={id}>
                            {g.displayName} at {e.name}
                          </label>
                          <select id={id} className="ops-input" name={`ent:${g.guestId}:${e.id}`} defaultValue={current ? current.plusOnePolicy : 'no'}>
                            <option value="no">Not invited</option>
                            <option value="none">Invited</option>
                            <option value="named">Invited + named guest</option>
                            <option value="unnamed">Invited + guest</option>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="ops-form-inline">
            <Button>Save invitations</Button>
          </div>
        </form>
      </Section>

      <Section title="Your Weekend notices" id="notices">
        {[...d.notices, null].map((n, idx) => (
          <form key={n?.id ?? 'new'} action={saveNoticeAction} className="ops-form con-panel" aria-label={n ? `Edit notice ${n.title}` : 'Post a notice'}>
            <IdemKey />
            {n ? <input type="hidden" name="id" value={n.id} /> : null}
            <h3>{n ? n.title : 'Post a notice'}</h3>
            <Input id={`nt-${idx}-title`} name="title" label="Title" defaultValue={n?.title ?? ''} required />
            <Input id={`nt-${idx}-body`} name="body" label="Message" type="textarea" defaultValue={n?.body ?? ''} required />
            <Radios
              name="severity"
              legend="Severity"
              options={[
                { value: 'info', label: 'Info', defaultChecked: (n?.severity ?? 'info') === 'info' },
                { value: 'urgent', label: 'Urgent', defaultChecked: n?.severity === 'urgent' },
              ]}
            />
            <Input id={`nt-${idx}-start`} name="startsAt" label="Show from (optional)" type="datetime-local" defaultValue={isoToChicagoLocal(n?.startsAt)} />
            <Input id={`nt-${idx}-end`} name="endsAt" label="Show until (optional)" type="datetime-local" defaultValue={isoToChicagoLocal(n?.endsAt)} />
            <Checkbox id={`nt-${idx}-active`} name="active" label="Active" defaultChecked={n ? n.active : true} />
            <div className="ops-form-inline">
              <Button variant="ghost">{n ? 'Save notice' : 'Post notice'}</Button>
            </div>
          </form>
        ))}
      </Section>
    </ConsolePage>
  );
}
