import { adminListReservationVenues } from '@/capabilities/admin_reservations';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { ConsoleGate, ConsolePage, Note, ScrollRegion, Section } from '../_components/console';

export const dynamic = 'force-dynamic';

export default async function AdminReservationsPage() {
  const { principal, result } = await invokeForPage(adminListReservationVenues, {});
  // AdminShell used to gate on the principal; ConsolePage is a frame, so the gate is the
  // route's own first statement — visible where the authorization decision is made.
  if (principal.kind !== 'admin') return <ConsoleGate what="Reservable places" />;
  return (
    <ConsolePage title="Reservable places">
      {!result.ok ? (
        <Note>{result.error.message}</Note>
      ) : (
        <>
          <Section title="Ladder rung per place">
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col">Rung</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Host</th>
                  <th scope="col">Placeholder</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.effective.map((o) => (
                  <tr key={o.venue.id} data-venue-id={o.venue.id}>
                    <td>{o.venue.name}</td>
                    <td>{o.rung}</td>
                    <td>{o.handoff?.providerDisplayName ?? '—'}</td>
                    <td>{o.handoff?.host ?? '—'}</td>
                    <td>{o.venue.placeholder ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </Section>
          <Section title="Configured rows">
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Id</th>
                  <th scope="col">Name</th>
                  <th scope="col">Resy</th>
                  <th scope="col">OpenTable</th>
                  <th scope="col">URL</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>None configured; guests see the built-in placeholders.</td>
                  </tr>
                ) : null}
                {result.value.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name}</td>
                    <td>{r.resySlug ?? '—'}</td>
                    <td>{r.openTableId ?? '—'}</td>
                    <td>{r.url ?? '—'}</td>
                    <td>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </Section>
          <Section title="Add or change a place" id="reservation-forms">
            <AdminCapabilityForm
              capability="admin_upsert_reservation_venue"
              title="Add or update a place"
              submitLabel="Save"
              fields={[
                { name: 'id', label: 'Id (slug)', type: 'text', required: true },
                { name: 'name', label: 'Name', type: 'text', required: true },
                { name: 'resySlug', label: 'Resy venue slug', type: 'text', help: 'resy.com/cities/chi/<slug>' },
                { name: 'openTableId', label: 'OpenTable restaurant id', type: 'text', help: 'opentable.com/r/<id>' },
                { name: 'url', label: 'Booking page URL (https, trusted partner)', type: 'url' },
                { name: 'note', label: 'Note for guests', type: 'text' },
                { name: 'sortOrder', label: 'Order', type: 'number', defaultValue: 0, min: 0, max: 1000 },
                { name: 'placeholder', label: 'Still a placeholder', type: 'checkbox' },
                { name: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
              ]}
            />
          </Section>
        </>
      )}
    </ConsolePage>
  );
}
