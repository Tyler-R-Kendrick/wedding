import type { Metadata } from 'next';
import { adminPreviewGuestTable, adminSeatingOverview } from '@/capabilities/rsvp';
import { SEATING_MESSAGE } from '@/capabilities/seating/get_my_table';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { PageLinks, paged } from '@/components/admin/flow/paging';
import { FilterBar, RecordList, RecordRow } from '@/components/admin/flow/records';
import { TableCard } from '@/components/weekend/TableCard';
import { FloorPlan } from '@/components/floorplan/FloorPlan';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Note, Pill, Section, Stamp } from '../_components/console';
import { Checkbox, Input } from '../_components/ops';
import { ListsProvider } from '@/components/admin/flow/lists';
import { DeleteTableFlow, ImportChartFlow, PublishFlow, SeatFlow, TableFlow, UnpublishFlow } from './_components/SeatingFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Seating (admin)', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Seating: the draft chart, what one guest would see, and publishing it.
 *
 * Every change is a flow from the admin kit (`components/admin/flow/CONVENTIONS.md`): adding,
 * editing and deleting tables, seating or moving a guest, importing the planner's chart, publishing
 * (a check of the draft first) and unpublishing (a confirmed danger flow). They replace a form per
 * table plus a blank one, a delete checkbox and red button under every table, a select, seat box
 * and Save button in every guest row, and two bare buttons that published or hid the chart at once.
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
  const previewId = one(sp.preview);
  const q = (one(sp.q) ?? '').trim();
  const unseatedOnly = one(sp.unseated) === 'on';
  const preview = previewId ? await adminInvoke(adminPreviewGuestTable, { guestId: previewId }) : null;

  const tableOptions = d.tables.map((t) => ({ value: t.id, label: `${t.name} (${t.assignments.length} of ${t.capacity})` }));
  const plans = d.floorPlans.map((p) => ({ id: p.id, name: p.name, anchors: p.anchors.map((a) => ({ id: a.id, label: a.label })) }));
  const planName = (id: string | null) => (id ? d.floorPlans.find((p) => p.id === id)?.name : undefined);
  const anchorLabel = (planId: string | null, anchorId: string | null) => d.floorPlans.find((p) => p.id === planId)?.anchors.find((a) => a.id === anchorId)?.label;
  const nextOrder = d.tables.reduce((m, t) => Math.max(m, t.sortOrder + 1), d.tables.length);
  const tableName = new Map(d.tables.map((t) => [t.id, t.name]));

  const everyone = [
    ...d.tables.flatMap((t) => t.assignments.map((a) => ({ ...a, tableId: t.id }))),
    ...d.unassigned.map((u) => ({ ...u, tableId: '', seatNumber: null as number | null })),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const seatRows = everyone.filter((g) => (!unseatedOnly || !g.tableId) && (!q || `${g.displayName} ${g.householdName}`.toLowerCase().includes(q.toLowerCase())));
  const shown = paged(seatRows, one(sp.page));
  const previewOptions = [{ value: '', label: 'Choose a guest' }, ...everyone.map((g) => ({ value: g.guestId, label: `${g.displayName} (${g.householdName})` }))];

  const draft = {
    tables: d.tables.length,
    seated: d.tables.reduce((n, t) => n + t.assignments.length, 0),
    attendingUnseated: d.unassigned.filter((u) => u.receptionRsvp === 'accepted').map((u) => u.displayName),
    emptyTables: d.tables.filter((t) => t.assignments.length === 0).map((t) => t.name),
    published: Boolean(d.publication),
    draftDiffers: d.draftDiffers,
  };

  return (
    <ConsolePage
      title="Seating"
      lede="Build the chart as a draft, check what a guest would see, then publish it. Guests see nothing of the draft until it is published."
      notice={notice}
      actions={
        <>
          <TableFlow plans={plans} nextOrder={nextOrder} label="Add a table" />
          <ImportChartFlow />
        </>
      }
    >
      <Section title="Publication" id="publication">
        <p className="flow-copy">
          {d.publication ? (
            <>
              <Pill tone="good">Published</Pill> <Stamp at={d.publication.publishedAt} /> · {d.publication.tables} tables · {d.publication.seated} seated
              {d.publication.note ? ` · ${d.publication.note}` : ''}
            </>
          ) : (
            <Pill tone="neutral">Not published: guests see nothing</Pill>
          )}{' '}
          {d.draftDiffers ? <Pill tone="warn">Draft differs from what guests see</Pill> : <Pill tone="neutral">Draft matches</Pill>}
        </p>
        <div className="flow-row__actions">
          <PublishFlow draft={draft} />
          {d.publication ? <UnpublishFlow /> : null}
        </div>
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

      <Section title="Preview what a guest sees" id="preview" note="What one guest would see under “Your table” if this draft were published. Nothing is published by previewing.">
        <FilterBar action="/admin/seating#preview" submitLabel="Preview">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {unseatedOnly ? <input type="hidden" name="unseated" value="on" /> : null}
          <Input id="preview-guest" name="preview" label="Guest" options={previewOptions} defaultValue={previewId ?? ''} />
        </FilterBar>
        {preview ? (
          preview.ok ? (
            <div>
              <p>
                <strong>{preview.value.data.displayName}</strong> would see:
              </p>
              {preview.value.data.state === 'seated' && preview.value.data.view ? (
                <TableCard table={preview.value.data.view} idPrefix="preview-fp" />
              ) : preview.value.data.state === 'not_entitled' ? (
                <p className="card__meta">
                  Nothing of their own: {SEATING_MESSAGE.not_entitled}
                  {preview.value.data.view ? ` They appear as a tablemate at ${preview.value.data.view.table.name}.` : ''}
                </p>
              ) : (
                <p className="card__meta">{SEATING_MESSAGE.not_seated}</p>
              )}
            </div>
          ) : (
            <Denied message={preview.error.message} />
          )
        ) : null}
      </Section>

      <Section title="Tables (draft)" id="tables">
        <RecordList label="Tables" empty={d.tables.length === 0 ? 'No tables yet. Add one, or import the planner’s chart.' : null}>
          {d.tables.map((t) => {
            const summary = { id: t.id, name: t.name, capacity: t.capacity, floorPlanId: t.floorPlanId, anchorId: t.anchorId, notes: t.notes, seated: t.assignments.length };
            const where = [planName(t.floorPlanId), anchorLabel(t.floorPlanId, t.anchorId)].filter(Boolean).join(', ');
            return (
              <RecordRow
                key={t.id}
                data-table-id={t.id}
                title={t.name}
                status={
                  <Pill tone={t.assignments.length >= t.capacity ? 'good' : 'neutral'}>
                    {t.assignments.length} of {t.capacity} seats
                  </Pill>
                }
                meta={
                  <>
                    {where || 'not on a floor plan yet'}
                    {t.notes ? ` · ${t.notes}` : ''}
                  </>
                }
                actions={
                  <>
                    <TableFlow table={summary} plans={plans} nextOrder={nextOrder} label="Edit" variant="quiet" />
                    <DeleteTableFlow table={summary} />
                  </>
                }
              >
                {t.assignments.length ? (
                  <p className="flow-row__meta">
                    {t.assignments
                      .slice()
                      .sort((a, b) => (a.seatNumber ?? 100) - (b.seatNumber ?? 100))
                      .map((a) => `${a.displayName}${a.seatNumber ? ` (seat ${a.seatNumber})` : ''}`)
                      .join(', ')}
                  </p>
                ) : null}
              </RecordRow>
            );
          })}
        </RecordList>
      </Section>

      <Section title="Seat a guest (draft)" id="assign">
        <FilterBar action="/admin/seating#assign">
          {previewId ? <input type="hidden" name="preview" value={previewId} /> : null}
          <Input id="seat-q" name="q" label="Search name or household" defaultValue={q} />
          <Checkbox id="seat-unseated" name="unseated" label="Only guests without a seat" defaultChecked={unseatedOnly} />
        </FilterBar>
        <ListsProvider lists={{ tables: tableOptions }}>
          <RecordList label="Guests and their seats" empty={seatRows.length === 0 ? (everyone.length ? 'Nobody matches this search.' : 'No guests yet.') : null}>
            {shown.rows.map((g) => (
              <RecordRow
                key={g.guestId}
                data-guest-id={g.guestId}
                title={g.displayName}
                status={g.receptionRsvp === 'accepted' ? <Pill tone="good">Coming</Pill> : g.receptionRsvp === 'declined' ? <Pill tone="bad">Not coming</Pill> : <Pill>No answer yet</Pill>}
                meta={
                  <>
                    {g.householdName} · {g.tableId ? `${tableName.get(g.tableId)}${g.seatNumber ? `, seat ${g.seatNumber}` : ''}` : 'no seat yet'}
                  </>
                }
                actions={
                  <>
                    <SeatFlow guest={{ guestId: g.guestId, displayName: g.displayName, tableId: g.tableId, seatNumber: g.seatNumber }} />
                    {g.tableId ? (
                      <QuickAction
                        label="Unseat"
                        busyLabel="Unseating…"
                        done={`${g.displayName} unseated (draft).`}
                        accessibleName={`Unseat ${g.displayName}`}
                        calls={[{ capability: 'admin_assign_seats', input: { changes: [{ guestId: g.guestId, tableId: null, seatNumber: null }] } }]}
                      />
                    ) : null}
                  </>
                }
              />
            ))}
          </RecordList>
        </ListsProvider>
        <PageLinks paging={shown} path="/admin/seating" params={{ q: q || undefined, unseated: unseatedOnly ? 'on' : undefined, preview: previewId }} noun="guests" anchor="assign" />
      </Section>

      <Section title="Floor plans" id="plans">
        <div className="con-plans">
          {d.floorPlans.map((p) => (
            <FloorPlan key={p.id} name={p.name} viewBox={p.viewBox} outline={p.outline} anchors={p.anchors} placeholder={p.placeholder} />
          ))}
        </div>
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>{d.publication ? `Live publication id: ${d.publication.id}.` : 'Nothing is published.'}</Note>
          <DataTable
            caption="Draft tables"
            empty={d.tables.length ? null : 'No tables.'}
            head={
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Id</th>
                <th scope="col">Floor plan</th>
                <th scope="col">Anchor</th>
                <th scope="col">Order</th>
              </tr>
            }
          >
            {d.tables.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td>{t.id}</td>
                <td>{t.floorPlanId ?? '—'}</td>
                <td>{t.anchorId ?? '—'}</td>
                <td>{t.sortOrder}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
