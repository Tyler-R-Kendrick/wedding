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
          <Section title="Gifts of money: what they go toward" id="gift-funds">
          <Note>
            Guests give toward a fund with their own Venmo, PayPal, Cash App, Zelle or a check. The money goes from their
            account straight to yours: this site never takes a payment, holds money, or adds a fee. The four built-in funds
            need nothing from you; save one with the same id to change its words or hide it.
          </Note>
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Id</th>
                  <th scope="col">Title</th>
                  <th scope="col">Description</th>
                  <th scope="col">Order</th>
                  <th scope="col">Shown</th>
                  <th scope="col">Words from</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.funds.map((f) => (
                  <tr key={f.id} data-gift-fund-id={f.id}>
                    <td>{f.id}</td>
                    <td>{f.title}</td>
                    <td>{f.description}</td>
                    <td>{f.sortOrder}</td>
                    <td>{f.active ? 'yes' : 'no'}</td>
                    <td>{f.origin === 'default' ? 'built in' : 'you'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <AdminCapabilityForm
            capability="admin_upsert_gift_fund"
            title="Add or change a fund"
            submitLabel="Save fund"
            fields={[
              { name: 'id', label: 'Id (slug)', type: 'text', required: true, help: 'honeymoon, home, adoption and next-adventures are built in. A new id adds a fund.' },
              { name: 'title', label: 'Title', type: 'text', required: true },
              { name: 'description', label: 'One line about it', type: 'text' },
              { name: 'sortOrder', label: 'Order', type: 'number', min: 0, max: 1000, help: 'Built in: 0, 10, 20, 30. Leave empty to keep a fund where it is.' },
              { name: 'active', label: 'Shown to guests', type: 'checkbox', defaultValue: true },
            ]}
          />
          </Section>
          <Section title="Gifts of money: ways to send one" id="gift-rails">
          <Note>
            {result.value.data.rails.length
              ? 'Guests see a button for each app below on every fund. Zelle and check details appear only to guests who opened the site from their invitation.'
              : 'None yet, so guests see no funds. Add at least one way to give and the funds appear on the Gifts page.'}
          </Note>
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Way</th>
                  <th scope="col">Sends to</th>
                  <th scope="col">Name guests should see</th>
                  <th scope="col">Shown</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.rails.map((r) => (
                  <tr key={r.rail} data-gift-rail={r.rail}>
                    <td>{r.displayName}</td>
                    <td className="whitespace-pre-line">{r.handle}</td>
                    <td>{r.recipientName}</td>
                    <td>{r.active ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <AdminCapabilityForm
            capability="admin_upsert_gift_rail"
            title="Add or change a way to give"
            submitLabel="Save"
            fields={[
              {
                name: 'rail',
                label: 'Way to give',
                type: 'select',
                options: [
                  { value: 'venmo', label: 'Venmo' },
                  { value: 'paypal', label: 'PayPal (PayPal.Me)' },
                  { value: 'cashapp', label: 'Cash App' },
                  { value: 'zelle', label: 'Zelle' },
                  { value: 'check', label: 'Check by mail' },
                ],
              },
              { name: 'handle', label: 'Username, email, phone or address', type: 'lines', required: true, help: 'Venmo: @username. PayPal: your PayPal.Me name. Cash App: $Cashtag. Zelle: the email or US mobile number you enrolled. Check: the mailing address, one line per row.' },
              { name: 'recipientName', label: 'Name guests should see', type: 'text', help: 'As the app shows it, or who a check is made out to, so guests know they have the right person.' },
              { name: 'active', label: 'Shown to guests', type: 'checkbox', defaultValue: true },
            ]}
          />
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
