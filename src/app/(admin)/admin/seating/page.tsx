import type { Metadata } from 'next';
import { adminSeatingOverview } from '@/capabilities/rsvp';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, Denied, Pill, ScrollRegion, Section, Stamp } from '../_components/console';
import { Button, Checkbox, IdemKey, Input } from '../_components/ops';
import { assignAction, deleteTableAction, importCsvAction, publishAction, saveTableAction, unpublishAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seating (admin)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Seating — on the admin console shell.
 *
 * Publication times were `publishedAt.slice(0, 16).replace('T', ' ') + ' UTC'` in four places on a
 * screen an operator reads in Chicago; they are `<Stamp>` now, which is the console's one formatter.
 * The guest RSVP kit's `Badge`, `Field`, `Select` and `.card` / `.tbl` classes are gone with it.
 */
export default async function AdminSeatingPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Seating" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };
  const r = await adminInvoke(adminSeatingOverview, {});
  if (!r.ok) {
    return (
      <ConsolePage title="Seating" notice={notice}>
        <Denied message={r.error.message} />
      </ConsolePage>
    );
  }
  const d = r.value.data;
  const tableOptions = d.tables.map((t) => ({ value: t.id, label: `${t.name} (${t.assignments.length}/${t.capacity})` }));
  const seatRows = [
    ...d.tables.flatMap((t) => t.assignments.map((a) => ({ ...a, tableId: t.id, receptionRsvp: null as null | 'accepted' | 'declined' }))),
    ...d.unassigned.map((u) => ({ ...u, tableId: '', seatNumber: null as number | null })),
  ];
  return (
    <ConsolePage title="Seating" notice={notice}>
      <Section title="Publication" id="publication">
        <p>
          {d.publication ? (
            <>
              <Pill tone="good">Published</Pill> <Stamp at={d.publication.publishedAt} /> · {d.publication.tables} tables · {d.publication.seated} seated
              {d.publication.note ? ` · ${d.publication.note}` : ''}
            </>
          ) : (
            <Pill tone="neutral">Not published — guests see nothing</Pill>
          )}{' '}
          {d.draftDiffers ? <Pill tone="warn">draft differs from what guests see</Pill> : <Pill tone="neutral">draft matches</Pill>}
        </p>
        <form action={publishAction} className="ops-form">
          <IdemKey />
          <Input id="pub-note" name="note" label="Note (internal)" />
          <div className="ops-form-inline">
            <Button>{d.publication ? 'Publish the current draft' : 'Publish seating to guests'}</Button>
          </div>
        </form>
        <form action={unpublishAction} className="ops-form-inline">
          <IdemKey />
          <Button variant="ghost">Unpublish</Button>
          <span className="con-index__blurb">Hides every table from guests again. The draft is untouched.</span>
        </form>
        {d.history.length ? (
          <ul className="list">
            {d.history.map((h) => (
              <li key={h.id}>
                <Stamp at={h.publishedAt} />
                {h.unpublishedAt ? (
                  <>
                    {' → unpublished '}
                    <Stamp at={h.unpublishedAt} />
                  </>
                ) : (
                  ' (live)'
                )}
                {h.note ? ` · ${h.note}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Tables (draft)" id="tables">
        {[...d.tables, null].map((t, idx) => (
          <div key={t?.id ?? 'new'} className="con-panel">
            <form action={saveTableAction} className="ops-form" aria-label={t ? `Edit ${t.name}` : 'Add a table'}>
              <IdemKey />
              {t ? <input type="hidden" name="id" value={t.id} /> : null}
              <h3>{t ? `${t.name} — ${t.assignments.length} of ${t.capacity} seats` : 'Add a table'}</h3>
              <Input id={`tb-${idx}-name`} name="name" label="Name" defaultValue={t?.name ?? ''} required />
              <Input id={`tb-${idx}-cap`} name="capacity" label="Capacity" type="number" defaultValue={String(t?.capacity ?? 10)} required />
              <Input id={`tb-${idx}-plan`} name="floorPlanId" label="Floor plan" defaultValue={t?.floorPlanId ?? ''} options={[{ value: '', label: 'None yet' }, ...d.floorPlans.map((p) => ({ value: p.id, label: p.name }))]} />
              <Input id={`tb-${idx}-anchor`} name="anchorId" label="Anchor on the plan" defaultValue={t?.anchorId ?? ''} hint={`Anchor ids: ${d.floorPlans[0]?.anchors.map((x) => x.id).join(', ') ?? 'none'}`} />
              <Input id={`tb-${idx}-sort`} name="sortOrder" label="Order" type="number" defaultValue={String(t?.sortOrder ?? idx)} />
              <Input id={`tb-${idx}-notes`} name="notes" label="Planning notes (admin only)" defaultValue={t?.notes ?? ''} />
              <div className="ops-form-inline">
                <Button variant="ghost">{t ? 'Save table' : 'Add table'}</Button>
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
                <form action={deleteTableAction} className="ops-form-inline">
                  <IdemKey />
                  <input type="hidden" name="id" value={t.id} />
                  <Button variant="danger">Delete {t.name}</Button>
                </form>
              </>
            ) : null}
          </div>
        ))}
      </Section>

      <Section title="Seat a guest (draft)" id="assign">
        <ScrollRegion scrollable={seatRows.length > 0}>
          <table className="ops-table con-table">
            <caption className="con-caption">Every guest and where they are seated</caption>
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Reception RSVP</th>
                <th scope="col">Table and seat</th>
              </tr>
            </thead>
            <tbody>
              {seatRows.map((g) => (
                <tr key={g.guestId}>
                  <th scope="row">
                    {g.displayName}
                    <br />
                    <span className="con-index__blurb">{g.householdName}</span>
                  </th>
                  <td>
                    {g.receptionRsvp === 'accepted' ? <Pill tone="good">attending</Pill> : g.receptionRsvp === 'declined' ? <Pill tone="bad">declined</Pill> : g.tableId ? '' : <Pill tone="neutral">no answer</Pill>}
                  </td>
                  <td>
                    <form action={assignAction} className="ops-form-inline">
                      <IdemKey />
                      <input type="hidden" name="guestId" value={g.guestId} />
                      <label className="sr-only" htmlFor={`as-${g.guestId}-table`}>
                        Table for {g.displayName}
                      </label>
                      <select id={`as-${g.guestId}-table`} className="ops-input" name="tableId" defaultValue={g.tableId || 'unassign'}>
                        <option value="unassign">Unassigned</option>
                        {tableOptions.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor={`as-${g.guestId}-seat`}>
                        Seat for {g.displayName}
                      </label>
                      <input id={`as-${g.guestId}-seat`} className="ops-input con-seat" name="seatNumber" type="number" min={1} max={99} defaultValue={g.seatNumber ?? ''} placeholder="seat" />
                      <Button variant="ghost">Save</Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      </Section>

      <Section title="Import the planner's chart" id="import">
        <form action={importCsvAction} className="ops-form">
          <IdemKey />
          <Input
            id="csv"
            name="csv"
            label="CSV: table, seat, guest"
            type="textarea"
            required
            hint="One guest per line. Guest = exact name as invited, or guest id. Missing tables are created. Nothing is applied if any line fails."
          />
          <Input id="csv-cap" name="defaultCapacity" label="Capacity for new tables" type="number" defaultValue="10" />
          <Checkbox id="csv-replace" name="replace" label="Replace all current draft assignments" />
          <div className="ops-form-inline">
            <Button>Import (draft)</Button>
          </div>
        </form>
      </Section>

      <Section title="Floor plans" id="plans">
        <div className="con-plans">
          {d.floorPlans.map((p) => (
            <FloorPlan key={p.id} name={p.name} viewBox={p.viewBox} outline={p.outline} anchors={p.anchors} placeholder={p.placeholder} />
          ))}
        </div>
      </Section>
    </ConsolePage>
  );
}
