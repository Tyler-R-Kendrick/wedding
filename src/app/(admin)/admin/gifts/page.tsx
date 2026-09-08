import { adminListGiftLinks } from '@/capabilities/admin_gifts';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { ConsoleGate, ConsolePage, Note, ScrollRegion, Section } from '../_components/console';

export const dynamic = 'force-dynamic';

export default async function AdminGiftsPage() {
  const { principal, result } = await invokeForPage(adminListGiftLinks, {});
  // AdminShell used to gate on the principal; ConsolePage is a frame, so the gate is the
  // route's own first statement — visible where the authorization decision is made.
  if (principal.kind !== 'admin') return <ConsoleGate what="Gift links" />;
  return (
    <ConsolePage title="Gift links">
      {!result.ok ? (
        <Note>{result.error.message}</Note>
      ) : (
        <>
          <Section title="What guests see now">
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Label</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Host</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Placeholder</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.effective.map((l) => (
                  <tr key={l.id} data-gift-link-id={l.id}>
                    <td>{l.kind}</td>
                    <td>{l.label}</td>
                    <td>{l.providerDisplayName}</td>
                    <td>{l.host}</td>
                    <td>{l.origin}</td>
                    <td>{l.placeholder ? 'yes' : 'no'}</td>
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
                  <th scope="col">Kind</th>
                  <th scope="col">Label</th>
                  <th scope="col">URL</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>None configured; guests see the built-in placeholders.</td>
                  </tr>
                ) : null}
                {result.value.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.kind}</td>
                    <td>{r.label}</td>
                    <td>{r.url}</td>
                    <td>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </Section>
          <Section title="Add or change a link" id="gift-forms">
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
          </Section>
        </>
      )}
    </ConsolePage>
  );
}
