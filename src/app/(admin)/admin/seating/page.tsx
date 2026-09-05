import type { Metadata } from 'next';
import { adminSeatingOverview } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { AdminGate, Denied, Outcome, outcomeFrom, type SearchParams } from '@/components/admin-e/AdminShell';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { Badge, Button, Checkbox, Field, Select, Textarea, TextInput } from '@/components/rsvp/fields';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { assignAction, deleteTableAction, importCsvAction, publishAction, saveTableAction, unpublishAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seating (admin)', robots: { index: false, follow: false } };

export default async function AdminSeatingPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  const outcome = await outcomeFrom(searchParams);
  return (
    <AdminGate principalKind={principal.kind}>
      <Body outcome={outcome} />
    </AdminGate>
  );
}

async function Body({ outcome }: { outcome: { ok?: string; error?: string } }) {
  const r = await adminInvoke(adminSeatingOverview, {});
  if (!r.ok) return <Denied message={r.error.message} />;
  const d = r.value.data;
  const tableOptions = d.tables.map((t) => ({ id: t.id, label: `${t.name} (${t.assignments.length}/${t.capacity})` }));
  return (
    <main id="main" className="page page--wide">
      <p className="page__eyebrow">Admin</p>
      <h1 className="page__title">Seating</h1>
      <Outcome {...outcome} />

      <section className="sec" aria-labelledby="pub-title">
        <h2 className="sec__title" id="pub-title">
          Publication
        </h2>
        <p>
          {d.publication ? (
            <>
              <Badge tone="yes">Published</Badge> {d.publication.publishedAt.slice(0, 16).replace('T', ' ')} UTC · {d.publication.tables} tables · {d.publication.seated} seated{d.publication.note ? ` · ${d.publication.note}` : ''}
            </>
          ) : (
            <Badge tone="pending">Not published — guests see nothing</Badge>
          )}{' '}
          {d.draftDiffers ? <Badge tone="stale">draft differs from what guests see</Badge> : <Badge tone="info">draft matches</Badge>}
        </p>
        <div className="grid-2">
          <form action={publishAction} className="card">
            <input type="hidden" name="idempotencyKey" value={newId()} />
            <Field id="pub-note" label="Note (internal)">
              {(a) => <TextInput id={a.id} name="note" maxLength={300} describedBy={a.describedBy} />}
            </Field>
            <div className="actions">
              <Button type="submit">{d.publication ? 'Publish the current draft' : 'Publish seating to guests'}</Button>
            </div>
          </form>
          <form action={unpublishAction} className="card">
            <input type="hidden" name="idempotencyKey" value={newId()} />
            <p className="card__meta">Hides every table from guests again. The draft is untouched.</p>
            <div className="actions">
              <Button type="submit" variant="secondary" disabled={!d.publication}>
                Unpublish
              </Button>
            </div>
          </form>
        </div>
        {d.history.length ? (
          <ul className="list">
            {d.history.map((h) => (
              <li key={h.id}>
                {h.publishedAt.slice(0, 16).replace('T', ' ')} UTC{h.unpublishedAt ? ` → unpublished ${h.unpublishedAt.slice(0, 16).replace('T', ' ')} UTC` : ' (live)'}
                {h.note ? ` · ${h.note}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="sec" aria-labelledby="tables-title">
        <h2 className="sec__title" id="tables-title">
          Tables (draft)
        </h2>
        {[...d.tables, null].map((t, idx) => (
          <div key={t?.id ?? 'new'} className="card">
            <form action={saveTableAction} aria-label={t ? `Edit ${t.name}` : 'Add a table'}>
              <input type="hidden" name="idempotencyKey" value={newId()} />
              {t ? <input type="hidden" name="id" value={t.id} /> : null}
              <h3 className="card__title">{t ? `${t.name} — ${t.assignments.length} of ${t.capacity} seats` : 'Add a table'}</h3>
              <div className="grid-2">
                <Field id={`tb-${idx}-name`} label="Name" required>
                  {(a) => <TextInput id={a.id} name="name" defaultValue={t?.name ?? ''} required maxLength={60} describedBy={a.describedBy} />}
                </Field>
                <Field id={`tb-${idx}-cap`} label="Capacity" required>
                  {(a) => <TextInput id={a.id} name="capacity" type="number" min={1} max={30} defaultValue={t?.capacity ?? 10} describedBy={a.describedBy} />}
                </Field>
                <Field id={`tb-${idx}-plan`} label="Floor plan">
                  {(a) => (
                    <Select id={a.id} name="floorPlanId" defaultValue={t?.floorPlanId ?? ''} placeholderLabel="None yet" describedBy={a.describedBy}>
                      {d.floorPlans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id={`tb-${idx}-anchor`} label="Anchor on the plan" hint={`Anchor ids: ${d.floorPlans[0]?.anchors.map((x) => x.id).join(', ') ?? 'none'}`}>
                  {(a) => <TextInput id={a.id} name="anchorId" defaultValue={t?.anchorId ?? ''} pattern="[a-z0-9-]{1,20}" describedBy={a.describedBy} />}
                </Field>
                <Field id={`tb-${idx}-sort`} label="Order">
                  {(a) => <TextInput id={a.id} name="sortOrder" type="number" min={0} max={1000} defaultValue={t?.sortOrder ?? idx} describedBy={a.describedBy} />}
                </Field>
                <Field id={`tb-${idx}-notes`} label="Planning notes (admin only)">
                  {(a) => <TextInput id={a.id} name="notes" defaultValue={t?.notes ?? ''} maxLength={500} describedBy={a.describedBy} />}
                </Field>
              </div>
              <div className="actions">
                <Button type="submit" variant="secondary">
                  {t ? 'Save table' : 'Add table'}
                </Button>
              </div>
            </form>
            {t ? (
              <>
                <ul className="list">
                  {t.assignments.map((a) => (
                    <li key={a.guestId}>
                      {a.displayName} ({a.householdName}){a.seatNumber ? `, seat ${a.seatNumber}` : ''}
                    </li>
                  ))}
                </ul>
                <form action={deleteTableAction} style={{ marginTop: 'var(--spacing-sm)' }}>
                  <input type="hidden" name="idempotencyKey" value={newId()} />
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" variant="ghost">
                    Delete {t.name}
                  </Button>
                </form>
              </>
            ) : null}
          </div>
        ))}
      </section>

      <section className="sec" aria-labelledby="assign-title">
        <h2 className="sec__title" id="assign-title">
          Seat a guest (draft)
        </h2>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Reception RSVP</th>
                <th scope="col">Table</th>
                <th scope="col">Seat</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {[...d.tables.flatMap((t) => t.assignments.map((a) => ({ ...a, tableId: t.id, receptionRsvp: null as null | 'accepted' | 'declined' }))), ...d.unassigned.map((u) => ({ ...u, tableId: '', seatNumber: null as number | null }))].map((g) => (
                <tr key={g.guestId}>
                  <td>
                    {g.displayName}
                    <br />
                    <span className="card__meta">{g.householdName}</span>
                  </td>
                  <td>{g.receptionRsvp === 'accepted' ? <Badge tone="yes">attending</Badge> : g.receptionRsvp === 'declined' ? <Badge tone="no">declined</Badge> : g.tableId ? '' : <Badge tone="pending">no answer</Badge>}</td>
                  <td colSpan={3}>
                    <form action={assignAction} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-sm)', alignItems: 'end' }}>
                      <input type="hidden" name="idempotencyKey" value={newId()} />
                      <input type="hidden" name="guestId" value={g.guestId} />
                      <label className="fld__label" htmlFor={`as-${g.guestId}-table`} style={{ position: 'absolute', left: -9999 }}>
                        Table for {g.displayName}
                      </label>
                      <select id={`as-${g.guestId}-table`} className="inp" name="tableId" defaultValue={g.tableId || 'unassign'} style={{ width: 'auto' }}>
                        <option value="unassign">Unassigned</option>
                        {tableOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <label className="fld__label" htmlFor={`as-${g.guestId}-seat`} style={{ position: 'absolute', left: -9999 }}>
                        Seat for {g.displayName}
                      </label>
                      <input id={`as-${g.guestId}-seat`} className="inp" name="seatNumber" type="number" min={1} max={99} defaultValue={g.seatNumber ?? ''} placeholder="seat" style={{ width: '6em' }} />
                      <Button type="submit" variant="secondary">
                        Save
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec" aria-labelledby="csv-title">
        <h2 className="sec__title" id="csv-title">
          Import the planner&apos;s chart
        </h2>
        <form action={importCsvAction} className="card">
          <input type="hidden" name="idempotencyKey" value={newId()} />
          <Field id="csv" label="CSV: table, seat, guest" hint="One guest per line. Guest = exact name as invited, or guest id. Missing tables are created. Nothing is applied if any line fails." required>
            {(a) => <Textarea id={a.id} name="csv" rows={8} required describedBy={a.describedBy} />}
          </Field>
          <div className="grid-2">
            <Field id="csv-cap" label="Capacity for new tables">
              {(a) => <TextInput id={a.id} name="defaultCapacity" type="number" min={1} max={30} defaultValue={10} describedBy={a.describedBy} />}
            </Field>
            <div className="choice" style={{ alignItems: 'end' }}>
              <Checkbox id="csv-replace" name="replace" label="Replace all current draft assignments" />
            </div>
          </div>
          <div className="actions">
            <Button type="submit">Import (draft)</Button>
          </div>
        </form>
      </section>

      <section className="sec" aria-labelledby="plans-title">
        <h2 className="sec__title" id="plans-title">
          Floor plans
        </h2>
        <div className="grid-2">
          {d.floorPlans.map((p) => (
            <FloorPlan key={p.id} name={p.name} viewBox={p.viewBox} outline={p.outline} anchors={p.anchors} placeholder={p.placeholder} />
          ))}
        </div>
      </section>
    </main>
  );
}
