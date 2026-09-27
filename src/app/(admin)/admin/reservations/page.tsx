import type { Metadata } from 'next';
import { adminListReservationVenues } from '@/capabilities/admin_reservations';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { invokeForPage } from '@/components/handoff/server';
import { ConsoleGate, ConsolePage, DataTable, Note, Pill, Section } from '../_components/console';
import { PlaceFlow, type PlaceRecord } from './_components/PlaceFlow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reservations (admin)', robots: { index: false, follow: false } };

type Option = { venue: { id: string; name: string; note: string | null; placeholder: boolean }; rung: 'api' | 'deep-link' | 'url' | 'unavailable'; handoff?: { providerDisplayName: string; host: string; url: string } };
type Row = PlaceRecord & { placeRef: string | null; verifiedAt: string | null };

/** How a guest books this place, in words: the "ladder rung" the old table printed as `deep-link`. */
function howGuestsBook(o: Option | undefined): string {
  if (!o) return 'hidden from guests';
  switch (o.rung) {
    case 'api':
      return `guests book on ${o.handoff?.providerDisplayName ?? 'the provider'} without leaving the site`;
    case 'deep-link':
      return `guests reserve on ${o.handoff?.providerDisplayName ?? 'the provider'}`;
    case 'url':
      return `guests reserve on ${o.handoff?.host ?? 'its own site'}`;
    default:
      return 'not bookable online: guests are told to ask you';
  }
}

/** The whole row, as the upsert takes it, with `patch` applied: a one-click change must not clear the rest. */
function placeInput(r: Row, patch: Partial<Pick<Row, 'active' | 'sortOrder'>>) {
  return {
    id: r.id,
    name: r.name,
    placeRef: r.placeRef ?? undefined,
    resySlug: r.resySlug ?? undefined,
    openTableId: r.openTableId ?? undefined,
    url: r.url ?? undefined,
    note: r.note ?? undefined,
    placeholder: r.placeholder,
    active: r.active,
    sortOrder: r.sortOrder,
    verifiedAt: r.verifiedAt ?? undefined,
    ...patch,
  };
}

/**
 * Places guests can reserve a table at, and how each is booked.
 *
 * Two tables of internals (a "ladder rung" per place, then the raw rows) sat above one form asking
 * for an "Id (slug)" and an "Order". The places are now a list saying in words how guests book each
 * one; adding and changing one is a flow that has the couple open the booking page guests will be
 * sent to; Show/Hide and Up/Down are one click; the raw rows are in the closed details.
 */
export default async function AdminReservationsPage() {
  const { principal, result } = await invokeForPage(adminListReservationVenues, {});
  // ConsolePage is a frame, so the gate is the route's own first statement — visible where the
  // authorization decision is made.
  if (principal.kind !== 'admin') return <ConsoleGate what="Reservable places" />;
  if (!result.ok) {
    return (
      <ConsolePage title="Reservable places">
        <Note>{result.error.message}</Note>
      </ConsolePage>
    );
  }
  const rows = result.value.data.rows as Row[];
  const effective = result.value.data.effective as Option[];
  const byId = new Map(effective.map((o) => [o.venue.id, o]));
  const ids = rows.map((r) => r.id);
  const nextSort = Math.min(1000, Math.max(0, ...rows.map((r) => r.sortOrder + 10)));
  const usingDefaults = rows.length === 0;

  return (
    <ConsolePage
      title="Reservable places"
      lede="Restaurants and bars you recommend for the weekend, and how guests reserve a table at each."
      actions={<PlaceFlow takenIds={ids} nextSort={nextSort} replacesDefaults={usingDefaults} label="Add a place" />}
    >
      {usingDefaults ? (
        <Section title="What guests see now" id="places">
          <Note>You have not saved any places, so guests see these built-in placeholders. Set one up, or add your own: once you save a place, the placeholders go.</Note>
          <RecordList label="Built-in places">
            {effective.map((o, i) => {
              const place: PlaceRecord = {
                id: o.venue.id,
                name: o.venue.name,
                resySlug: null,
                openTableId: null,
                url: o.rung === 'url' ? (o.handoff?.url ?? null) : null,
                note: o.venue.note,
                placeholder: o.venue.placeholder,
                active: true,
                sortOrder: i * 10,
              };
              return (
                <RecordRow
                  key={o.venue.id}
                  data-venue-id={o.venue.id}
                  title={o.venue.name}
                  status={<Pill tone="warn">Built-in placeholder</Pill>}
                  meta={howGuestsBook(o)}
                  actions={<PlaceFlow place={place} takenIds={ids} replacesDefaults variant="quiet" label="Set up" accessibleName={`Set up ${o.venue.name}`} />}
                />
              );
            })}
          </RecordList>
        </Section>
      ) : (
        <Section title="Places" id="places">
          <RecordList label="Places">
            {rows.map((r, i) => {
              const o = byId.get(r.id);
              const prev = rows[i - 1];
              const next = rows[i + 1];
              const move = (other: Row, before: boolean) => {
                const mine = other.sortOrder === r.sortOrder ? Math.max(0, other.sortOrder + (before ? -1 : 1)) : other.sortOrder;
                return [
                  { capability: 'admin_upsert_reservation_venue', input: placeInput(r, { sortOrder: mine }) },
                  { capability: 'admin_upsert_reservation_venue', input: placeInput(other, { sortOrder: r.sortOrder }) },
                ];
              };
              return (
                <RecordRow
                  key={r.id}
                  data-venue-id={r.id}
                  title={r.name}
                  status={
                    <>
                      {r.active ? <Pill tone="good">Shown</Pill> : <Pill>Hidden</Pill>} {r.placeholder ? <Pill tone="warn">Details to confirm</Pill> : null}
                    </>
                  }
                  meta={
                    <>
                      {r.active ? howGuestsBook(o) : 'hidden from guests'}
                      {r.note ? ` · ${r.note}` : ''}
                    </>
                  }
                  actions={
                    <>
                      {o?.handoff ? (
                        <a className="flow-link" href={o.handoff.url} target="_blank" rel="noopener noreferrer">
                          Open<span aria-hidden="true"> ↗</span>
                          <span className="sr-only"> the booking page for {r.name} (new tab)</span>
                        </a>
                      ) : null}
                      <PlaceFlow place={r} takenIds={ids} variant="quiet" label="Change" accessibleName={`Change ${r.name}`} />
                      <QuickAction
                        label={r.active ? 'Hide' : 'Show'}
                        busyLabel={r.active ? 'Hiding…' : 'Showing…'}
                        done={r.active ? `${r.name} hidden.` : `${r.name} shown.`}
                        accessibleName={`${r.active ? 'Hide' : 'Show'} ${r.name}`}
                        calls={[{ capability: 'admin_upsert_reservation_venue', input: placeInput(r, { active: !r.active }) }]}
                      />
                      <QuickAction label="Up" busyLabel="Moving…" done={`Moved ${r.name} up.`} unavailable={!prev} accessibleName={`Move ${r.name} up`} calls={prev ? move(prev, true) : []} />
                      <QuickAction label="Down" busyLabel="Moving…" done={`Moved ${r.name} down.`} unavailable={!next} accessibleName={`Move ${r.name} down`} calls={next ? move(next, false) : []} />
                    </>
                  }
                />
              );
            })}
          </RecordList>
        </Section>
      )}

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>What guests are offered for each place, and every saved row including hidden ones. For troubleshooting; nothing here needs changing by hand.</Note>
          <DataTable
            caption="What guests are offered"
            empty={effective.length ? null : 'Nothing: every saved place is hidden.'}
            head={
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Rung</th>
                <th scope="col">Provider</th>
                <th scope="col">Host</th>
                <th scope="col">Placeholder</th>
              </tr>
            }
          >
            {effective.map((o) => (
              <tr key={o.venue.id}>
                <td>{o.venue.name}</td>
                <td>{o.rung}</td>
                <td>{o.handoff?.providerDisplayName ?? '—'}</td>
                <td>{o.handoff?.host ?? '—'}</td>
                <td>{o.venue.placeholder ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </DataTable>
          <DataTable
            caption="Places, as saved"
            empty={rows.length ? null : 'None saved; guests see the built-in placeholders.'}
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Resy</th>
                <th scope="col">OpenTable</th>
                <th scope="col">URL</th>
                <th scope="col">Order</th>
                <th scope="col">Shown</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.resySlug ?? '—'}</td>
                <td>{r.openTableId ?? '—'}</td>
                <td className="ops-code">{r.url ?? '—'}</td>
                <td>{r.sortOrder}</td>
                <td>{r.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
