import type { Metadata } from 'next';
import { adminExportNeeds, adminListEvents, adminRsvpOverview } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { AdminGate, Denied, Outcome, outcomeFrom, type SearchParams } from '@/components/admin-e/AdminShell';
import { Badge, Button, Checkbox, ChoiceGroup, Field, Select, TextInput } from '@/components/rsvp/fields';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { overrideAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'RSVPs (admin)', robots: { index: false, follow: false } };

export default async function AdminRsvpPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  const sp = await searchParams;
  const outcome = await outcomeFrom(searchParams);
  const showNeeds = sp.needs === '1';
  return (
    <AdminGate principalKind={principal.kind}>
      <Body outcome={outcome} showNeeds={showNeeds} />
    </AdminGate>
  );
}

async function Body({ outcome, showNeeds }: { outcome: { ok?: string; error?: string }; showNeeds: boolean }) {
  const [overview, events] = await Promise.all([adminInvoke(adminRsvpOverview, {}), adminInvoke(adminListEvents, {})]);
  if (!overview.ok) return <Denied message={overview.error.message} />;
  const d = overview.value.data;
  const ev = events.ok ? events.value.data : null;
  // Sensitive: loaded only on explicit request (the capability call itself is the audit trail).
  const needs = showNeeds ? await adminInvoke(adminExportNeeds, { includeNeeds: true }) : null;
  return (
    <main id="main" className="page page--wide">
      <p className="page__eyebrow">Admin</p>
      <h1 className="page__title">RSVPs</h1>
      <Outcome {...outcome} />
      <p className="card__meta">RSVPs are {d.window.open ? 'open' : 'closed'} ({d.window.reason.replace('_', ' ')}).</p>

      <section className="sec" aria-labelledby="counts-title">
        <h2 className="sec__title" id="counts-title">
          By event
        </h2>
        {d.events.map((e) => (
          <div key={e.id} className="card">
            <h3 className="card__title">{e.name}</h3>
            <div>
              {[
                ['invited', e.invited],
                ['attending', e.accepted],
                ['declined', e.declined],
                ['no answer', e.pending],
                ['plus-ones', e.plusOnes],
                ['stale meals', e.staleMeals],
              ].map(([label, value]) => (
                <div key={String(label)} className="stat">
                  <span className="stat__value">{value}</span>
                  <span className="stat__label">{label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="actions">
          <a className="btn btn--secondary" href="/admin/rsvp/export">
            Download RSVP CSV
          </a>
          <a className="btn btn--secondary" href="/admin/rsvp/export?needs=1">
            Download dietary &amp; accessibility CSV (audited)
          </a>
          {showNeeds ? (
            <a className="btn btn--ghost" href="/admin/rsvp">
              Hide notes
            </a>
          ) : (
            <a className="btn btn--ghost" href="/admin/rsvp?needs=1">
              Show dietary &amp; accessibility notes (audited)
            </a>
          )}
        </div>
      </section>

      {needs ? (
        <section className="sec" aria-labelledby="needs-title">
          <h2 className="sec__title" id="needs-title">
            Dietary and accessibility notes
          </h2>
          {needs.ok ? (
            needs.value.data.rows.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th scope="col">Household</th>
                      <th scope="col">Guest</th>
                      <th scope="col">Dietary</th>
                      <th scope="col">Accessibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.value.data.rows.map((n) => (
                      <tr key={n.guestId}>
                        <td>{n.householdName}</td>
                        <td>{n.displayName}</td>
                        <td>{n.dietary ?? ''}</td>
                        <td>{n.accessibility ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="card__meta">No notes recorded yet.</p>
            )
          ) : (
            <p className="fld__error">{needs.error.message}</p>
          )}
        </section>
      ) : null}

      <section className="sec" aria-labelledby="rows-title">
        <h2 className="sec__title" id="rows-title">
          Every answer
        </h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Household</th>
                <th scope="col">Guest</th>
                <th scope="col">Answer</th>
                <th scope="col">Meal</th>
                <th scope="col">Plus-one</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={`${r.guestId}-${r.eventId}`}>
                  <td>{r.eventName}</td>
                  <td>{r.householdName}</td>
                  <td>{r.displayName}</td>
                  <td>{r.status === 'accepted' ? <Badge tone="yes">attending</Badge> : r.status === 'declined' ? <Badge tone="no">declined</Badge> : <Badge tone="pending">no answer</Badge>}</td>
                  <td>
                    {r.mealLabel ?? ''} {r.mealStale ? <Badge tone="stale">menu changed</Badge> : null}
                  </td>
                  <td>{r.plusOnePolicy === 'none' ? '—' : r.plusOne?.attending ? `${r.plusOne.name ?? 'unnamed'}${r.plusOne.mealLabel ? ` (${r.plusOne.mealLabel})` : ''}` : 'no'}</td>
                  <td>
                    {r.updatedAt ? r.updatedAt.slice(0, 10) : ''} {r.submittedVia === 'admin' ? <Badge tone="info">by admin</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {ev ? (
        <section className="sec" aria-labelledby="override-title">
          <h2 className="sec__title" id="override-title">
            Record or correct an answer
          </h2>
          <p className="card__meta">Use after a phone call or e-mail. Works after the deadline; audited with your reason.</p>
          <form action={overrideAction} className="card">
            <input type="hidden" name="idempotencyKey" value={newId()} />
            <div className="grid-2">
              <Field id="ov-guest" label="Guest" required>
                {(a) => (
                  <Select id={a.id} name="guestId" placeholderLabel="Choose a guest" required describedBy={a.describedBy}>
                    {ev.guests.map((g) => (
                      <option key={g.guestId} value={g.guestId}>
                        {g.displayName} ({g.householdName})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="ov-event" label="Event" required>
                {(a) => (
                  <Select id={a.id} name="eventId" placeholderLabel="Choose an event" required describedBy={a.describedBy}>
                    {ev.events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <ChoiceGroup idBase="ov-status" name="status" legend="Answer" options={[{ value: 'accepted', label: 'Attending', defaultChecked: true }, { value: 'declined', label: 'Not attending' }]} />
            <Field id="ov-meal" label="Meal (current menu)" hint="Only for events with a menu.">
              {(a) => (
                <Select id={a.id} name="mealOptionId" placeholderLabel="No meal" describedBy={a.describedBy}>
                  {ev.events.flatMap((e) => e.mealOptions.map((m) => ({ e, m }))).map(({ e, m }) => (
                    <option key={m.id} value={m.id}>
                      {e.name}: {m.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="choice" style={{ marginTop: 'var(--spacing-md)' }}>
              <Checkbox id="ov-p1" name="plusOne" label="Bringing a guest" />
            </div>
            <div className="grid-2">
              <Field id="ov-p1name" label="Guest's name">
                {(a) => <TextInput id={a.id} name="plusOneName" maxLength={80} describedBy={a.describedBy} />}
              </Field>
              <Field id="ov-p1meal" label="Guest's meal">
                {(a) => (
                  <Select id={a.id} name="plusOneMealOptionId" placeholderLabel="No meal" describedBy={a.describedBy}>
                    {ev.events.flatMap((e) => e.mealOptions.map((m) => ({ e, m }))).map(({ e, m }) => (
                      <option key={m.id} value={m.id}>
                        {e.name}: {m.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field id="ov-reason" label="Reason (audited)" required>
              {(a) => <TextInput id={a.id} name="reason" required minLength={3} maxLength={300} describedBy={a.describedBy} />}
            </Field>
            <div className="actions">
              <Button type="submit">Record answer</Button>
            </div>
          </form>
        </section>
      ) : null}
    </main>
  );
}
