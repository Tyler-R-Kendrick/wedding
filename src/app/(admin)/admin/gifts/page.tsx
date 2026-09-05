import { adminListGiftLinks } from '@/capabilities/admin_gifts';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { AdminShell, ScrollRegion, SECTION_TITLE, TABLE, TD, TH } from '../_shared';

export const dynamic = 'force-dynamic';

export default async function AdminGiftsPage() {
  const { principal, result } = await invokeForPage(adminListGiftLinks, {});
  return (
    <AdminShell title="Gift links" principal={principal}>
      {!result.ok ? (
        <p className="mt-4">{result.error.message}</p>
      ) : (
        <>
          <h2 className={SECTION_TITLE}>What guests see now</h2>
          <ScrollRegion label="What guests see now">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Kind</th>
                  <th className={TH} scope="col">Label</th>
                  <th className={TH} scope="col">Provider</th>
                  <th className={TH} scope="col">Host</th>
                  <th className={TH} scope="col">Origin</th>
                  <th className={TH} scope="col">Placeholder</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.effective.map((l) => (
                  <tr key={l.id} data-gift-link-id={l.id}>
                    <td className={TD}>{l.kind}</td>
                    <td className={TD}>{l.label}</td>
                    <td className={TD}>{l.providerDisplayName}</td>
                    <td className={TD}>{l.host}</td>
                    <td className={TD}>{l.origin}</td>
                    <td className={TD}>{l.placeholder ? 'yes' : 'no'}</td>
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
                  <th className={TH} scope="col">Kind</th>
                  <th className={TH} scope="col">Label</th>
                  <th className={TH} scope="col">URL</th>
                  <th className={TH} scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.rows.length === 0 ? (
                  <tr>
                    <td className={TD} colSpan={5}>None configured; guests see the built-in placeholders.</td>
                  </tr>
                ) : null}
                {result.value.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={TD}>{r.id}</td>
                    <td className={TD}>{r.kind}</td>
                    <td className={TD}>{r.label}</td>
                    <td className={TD}>{r.url}</td>
                    <td className={TD}>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="mt-10">
            <AdminCapabilityForm
              capability="admin_upsert_gift_link"
              title="Add or update a gift link"
              submitLabel="Save"
              fields={[
                { name: 'id', label: 'Id (slug)', type: 'text', required: true, help: 'Reusing an id updates that row.' },
                { name: 'kind', label: 'Kind', type: 'select', options: [{ value: 'registry', label: 'Registry (wishlist)' }, { value: 'adventure-fund', label: 'Next adventures (experiences, gift cards)' }] },
                { name: 'provider', label: 'Provider', type: 'select', options: [{ value: 'zola', label: 'Zola' }, { value: 'theknot', label: 'The Knot' }, { value: 'withjoy', label: 'Joy' }, { value: 'custom', label: 'Other (allowlisted host)' }] },
                { name: 'label', label: 'Label', type: 'text', required: true },
                { name: 'url', label: 'URL (https, trusted partner)', type: 'url', required: true },
                { name: 'note', label: 'Note', type: 'text' },
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
