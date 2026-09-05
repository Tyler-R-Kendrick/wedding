import { adminListReservationVenues } from '@/capabilities/admin_reservations';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { AdminShell, ScrollRegion, SECTION_TITLE, TABLE, TD, TH } from '../_shared';

export const dynamic = 'force-dynamic';

export default async function AdminReservationsPage() {
  const { principal, result } = await invokeForPage(adminListReservationVenues, {});
  return (
    <AdminShell title="Reservable places" principal={principal}>
      {!result.ok ? (
        <p className="mt-4">{result.error.message}</p>
      ) : (
        <>
          <h2 className={SECTION_TITLE}>Ladder rung per place</h2>
          <ScrollRegion label="Ladder rung per place">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Place</th>
                  <th className={TH} scope="col">Rung</th>
                  <th className={TH} scope="col">Provider</th>
                  <th className={TH} scope="col">Host</th>
                  <th className={TH} scope="col">Placeholder</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.effective.map((o) => (
                  <tr key={o.venue.id} data-venue-id={o.venue.id}>
                    <td className={TD}>{o.venue.name}</td>
                    <td className={TD}>{o.rung}</td>
                    <td className={TD}>{o.handoff?.providerDisplayName ?? '—'}</td>
                    <td className={TD}>{o.handoff?.host ?? '—'}</td>
                    <td className={TD}>{o.venue.placeholder ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <h2 className={SECTION_TITLE}>Configured rows</h2>
          <ScrollRegion label="Configured rows">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Id</th>
                  <th className={TH} scope="col">Name</th>
                  <th className={TH} scope="col">Resy</th>
                  <th className={TH} scope="col">OpenTable</th>
                  <th className={TH} scope="col">URL</th>
                  <th className={TH} scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.rows.length === 0 ? (
                  <tr>
                    <td className={TD} colSpan={6}>None configured; guests see the built-in placeholders.</td>
                  </tr>
                ) : null}
                {result.value.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={TD}>{r.id}</td>
                    <td className={TD}>{r.name}</td>
                    <td className={TD}>{r.resySlug ?? '—'}</td>
                    <td className={TD}>{r.openTableId ?? '—'}</td>
                    <td className={TD}>{r.url ?? '—'}</td>
                    <td className={TD}>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="mt-10">
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
          </div>
        </>
      )}
    </AdminShell>
  );
}
