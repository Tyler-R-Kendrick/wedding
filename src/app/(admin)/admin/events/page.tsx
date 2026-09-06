import type { Metadata } from 'next';
import { adminListEvents } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { AdminGate, Denied, Outcome, outcomeFrom, type SearchParams } from '@/components/admin-e/AdminShell';
import { Button, Checkbox, ChoiceGroup, Field, Select, Textarea, TextInput } from '@/components/rsvp/fields';
import { isoToChicagoLocal } from '@/domain/events/format';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { saveEntitlementsAction, saveEventAction, saveMealsAction, saveNoticeAction, saveWindowAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Events (admin)', robots: { index: false, follow: false } };

export default async function AdminEventsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  const outcome = await outcomeFrom(searchParams);
  return (
    <AdminGate principalKind={principal.kind}>
      <Body outcome={outcome} />
    </AdminGate>
  );
}

async function Body({ outcome }: { outcome: { ok?: string; error?: string } }) {
  const r = await adminInvoke(adminListEvents, {});
  if (!r.ok) return <Denied message={r.error.message} />;
  const d = r.value.data;
  return (
    <main id="main" className="page page--wide">
      <p className="page__eyebrow">Admin</p>
      <h1 className="page__title">Events, menu, invitations, RSVP window</h1>
      <Outcome {...outcome} />

      <section className="sec" aria-labelledby="window-title">
        <h2 className="sec__title" id="window-title">
          RSVP window
        </h2>
        <p className="card__meta">
          Right now RSVPs are <strong>{d.window.open ? 'open' : 'closed'}</strong> ({d.window.reason.replace('_', ' ')}; lifecycle {d.window.lifecycle}). Manual open/closed beats the schedule.
        </p>
        <form action={saveWindowAction} className="card">
          <input type="hidden" name="idempotencyKey" value={newId()} />
          <ChoiceGroup
            idBase="window-mode"
            name="mode"
            legend="Mode"
            options={[
              { value: 'auto', label: 'Automatic (open during RSVP_OPEN until the deadline)', defaultChecked: d.settings.mode === 'auto' },
              { value: 'open', label: 'Open now', defaultChecked: d.settings.mode === 'open' },
              { value: 'closed', label: 'Closed now', defaultChecked: d.settings.mode === 'closed' },
            ]}
          />
          <Field id="window-deadline" label="Deadline (America/Chicago)" hint="Leave empty while TODO(Tyler & Sara).">
            {(a) => <TextInput id={a.id} name="deadlineAt" type="datetime-local" defaultValue={isoToChicagoLocal(d.settings.deadlineAt)} describedBy={a.describedBy} />}
          </Field>
          <Field id="window-note" label="Note (internal)">
            {(a) => <TextInput id={a.id} name="note" defaultValue={d.settings.note ?? ''} maxLength={300} describedBy={a.describedBy} />}
          </Field>
          <div className="actions">
            <Button type="submit">Save RSVP window</Button>
          </div>
        </form>
      </section>

      <section className="sec" aria-labelledby="events-title">
        <h2 className="sec__title" id="events-title">
          Events
        </h2>
        {[...d.events, null].map((e, idx) => (
          <form key={e?.id ?? 'new'} action={saveEventAction} className="card" aria-label={e ? `Edit ${e.name}` : 'Add an event'}>
            <input type="hidden" name="idempotencyKey" value={newId()} />
            {e ? <input type="hidden" name="id" value={e.id} /> : null}
            <h3 className="card__title">{e ? e.name : 'Add an event'}</h3>
            {e ? <p className="card__meta">Invited: {e.invitedCount} · Menu version {e.mealOptionsVersion} ({e.mealOptions.length} options)</p> : null}
            <div className="grid-2">
              <Field id={`ev-${idx}-name`} label="Name" required>
                {(a) => <TextInput id={a.id} name="name" defaultValue={e?.name ?? ''} required maxLength={80} describedBy={a.describedBy} />}
              </Field>
              <Field id={`ev-${idx}-date`} label="Date" required>
                {(a) => <TextInput id={a.id} name="dateIso" type="date" defaultValue={e?.dateIso ?? '2027-07-17'} describedBy={a.describedBy} />}
              </Field>
              <Field id={`ev-${idx}-start`} label="Starts (America/Chicago)">
                {(a) => <TextInput id={a.id} name="startsAt" type="datetime-local" defaultValue={isoToChicagoLocal(e?.startsAt)} describedBy={a.describedBy} />}
              </Field>
              <Field id={`ev-${idx}-end`} label="Ends (America/Chicago)">
                {(a) => <TextInput id={a.id} name="endsAt" type="datetime-local" defaultValue={isoToChicagoLocal(e?.endsAt)} describedBy={a.describedBy} />}
              </Field>
              <Field id={`ev-${idx}-space`} label="Room">
                {(a) => (
                  <Select id={a.id} name="venueSpaceRef" defaultValue={e?.venueSpaceRef ?? ''} placeholderLabel="Not confirmed" describedBy={a.describedBy}>
                    {d.venueSpaces.map((s) => (
                      <option key={s.ref} value={s.ref}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id={`ev-${idx}-dress`} label="Dress code">
                {(a) => <TextInput id={a.id} name="dressCode" defaultValue={e?.dressCode ?? ''} maxLength={200} describedBy={a.describedBy} />}
              </Field>
              <Field id={`ev-${idx}-sort`} label="Order">
                {(a) => <TextInput id={a.id} name="sortOrder" type="number" min={0} max={1000} defaultValue={e?.sortOrder ?? (idx + 1) * 10} describedBy={a.describedBy} />}
              </Field>
            </div>
            <Field id={`ev-${idx}-desc`} label="What happens">
              {(a) => <Textarea id={a.id} name="description" defaultValue={e?.description ?? ''} rows={2} maxLength={2000} describedBy={a.describedBy} />}
            </Field>
            <Field id={`ev-${idx}-access`} label="Accessibility note">
              {(a) => <Textarea id={a.id} name="accessibilityNote" defaultValue={e?.accessibilityNote ?? ''} rows={2} maxLength={1000} describedBy={a.describedBy} />}
            </Field>
            <div className="choice" style={{ marginTop: 'var(--spacing-md)' }}>
              <Checkbox id={`ev-${idx}-placeholder`} name="placeholder" label="Details not confirmed yet (shown as placeholder)" defaultChecked={e ? e.placeholder : true} />
              <Checkbox id={`ev-${idx}-rsvp`} name="rsvpRequired" label="Guests RSVP to this event" defaultChecked={e ? e.rsvpRequired : true} />
            </div>
            <div className="actions">
              <Button type="submit">{e ? 'Save event' : 'Add event'}</Button>
            </div>
          </form>
        ))}
      </section>

      <section className="sec" aria-labelledby="menu-title">
        <h2 className="sec__title" id="menu-title">
          Menus
        </h2>
        {d.events.map((e) => (
          <form key={e.id} action={saveMealsAction} className="card" aria-label={`Menu for ${e.name}`}>
            <input type="hidden" name="idempotencyKey" value={newId()} />
            <input type="hidden" name="eventId" value={e.id} />
            <h3 className="card__title">{e.name} — publish menu version {e.mealOptionsVersion + 1}</h3>
            <Field id={`menu-${e.id}`} label="One option per line" hint="Format: Label | short description. Empty = no meal choice for this event. Guests who chose from an older version are asked to choose again.">
              {(a) => <Textarea id={a.id} name="options" rows={4} defaultValue={e.mealOptions.map((m) => (m.description ? `${m.label} | ${m.description}` : m.label)).join('\n')} describedBy={a.describedBy} />}
            </Field>
            <div className="actions">
              <Button type="submit" variant="secondary">
                Publish new menu version
              </Button>
            </div>
          </form>
        ))}
      </section>

      <section className="sec" aria-labelledby="ent-title">
        <h2 className="sec__title" id="ent-title">
          Who is invited to what
        </h2>
        <form action={saveEntitlementsAction}>
          <input type="hidden" name="idempotencyKey" value={newId()} />
          <div className="tbl-wrap">
            <table className="tbl">
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
                      <span className="card__meta">{g.householdName}{g.isMinor ? ' · child' : ''}</span>
                    </th>
                    {d.events.map((e) => {
                      const current = d.entitlements.find((en) => en.guestId === g.guestId && en.eventId === e.id);
                      const id = `ent-${g.guestId}-${e.id}`;
                      return (
                        <td key={e.id}>
                          <label className="fld__label" htmlFor={id} style={{ position: 'absolute', left: -9999 }}>
                            {g.displayName} at {e.name}
                          </label>
                          <select id={id} className="inp" name={`ent:${g.guestId}:${e.id}`} defaultValue={current ? current.plusOnePolicy : 'no'}>
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
          </div>
          <div className="actions">
            <Button type="submit">Save invitations</Button>
          </div>
        </form>
      </section>

      <section className="sec" aria-labelledby="notice-title">
        <h2 className="sec__title" id="notice-title">
          Your Weekend notices
        </h2>
        {[...d.notices, null].map((n, idx) => (
          <form key={n?.id ?? 'new'} action={saveNoticeAction} className="card" aria-label={n ? `Edit notice ${n.title}` : 'Post a notice'}>
            <input type="hidden" name="idempotencyKey" value={newId()} />
            {n ? <input type="hidden" name="id" value={n.id} /> : null}
            <h3 className="card__title">{n ? n.title : 'Post a notice'}</h3>
            <Field id={`nt-${idx}-title`} label="Title" required>
              {(a) => <TextInput id={a.id} name="title" defaultValue={n?.title ?? ''} maxLength={120} required describedBy={a.describedBy} />}
            </Field>
            <Field id={`nt-${idx}-body`} label="Message" required>
              {(a) => <Textarea id={a.id} name="body" defaultValue={n?.body ?? ''} rows={3} maxLength={1000} required describedBy={a.describedBy} />}
            </Field>
            <ChoiceGroup idBase={`nt-${idx}-sev`} name="severity" legend="Severity" options={[{ value: 'info', label: 'Info', defaultChecked: (n?.severity ?? 'info') === 'info' }, { value: 'urgent', label: 'Urgent', defaultChecked: n?.severity === 'urgent' }]} />
            <div className="grid-2">
              <Field id={`nt-${idx}-start`} label="Show from (optional)">
                {(a) => <TextInput id={a.id} name="startsAt" type="datetime-local" defaultValue={isoToChicagoLocal(n?.startsAt)} describedBy={a.describedBy} />}
              </Field>
              <Field id={`nt-${idx}-end`} label="Show until (optional)">
                {(a) => <TextInput id={a.id} name="endsAt" type="datetime-local" defaultValue={isoToChicagoLocal(n?.endsAt)} describedBy={a.describedBy} />}
              </Field>
            </div>
            <div className="choice" style={{ marginTop: 'var(--spacing-md)' }}>
              <Checkbox id={`nt-${idx}-active`} name="active" label="Active" defaultChecked={n ? n.active : true} />
            </div>
            <div className="actions">
              <Button type="submit" variant="secondary">
                {n ? 'Save notice' : 'Post notice'}
              </Button>
            </div>
          </form>
        ))}
      </section>
    </main>
  );
}
