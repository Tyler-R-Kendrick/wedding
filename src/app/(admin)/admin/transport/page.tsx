import { adminListTransportationEntitlements } from '@/capabilities/admin_transport';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { ConsoleGate, ConsolePage, Note, ScrollRegion, Section } from '../_components/console';

export const dynamic = 'force-dynamic';

/** Ride benefits: assignment and eligibility, manual code upload (counts only), claim status. Never a code or link. */
export default async function AdminTransportPage() {
  const { principal, result } = await invokeForPage(adminListTransportationEntitlements, {});
  // AdminShell used to gate on the principal; ConsolePage is a frame, so the gate is the
  // route's own first statement — visible where the authorization decision is made.
  if (principal.kind !== 'admin') return <ConsoleGate what="Transport" />;
  return (
    <ConsolePage title="Ride benefits">
      {!result.ok ? (
        <Note>{result.error.message}</Note>
      ) : (
        <>
          <Note>
            Provider: {result.value.data.provider.name} ({result.value.data.provider.mode}). Codes and redemption links are sealed and never shown here.
          </Note>
          <Section title="Entitlements and claims">
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">Household</th>
                  <th scope="col">Programme</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Eligibility</th>
                  <th scope="col">Status</th>
                  <th scope="col">Claim</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.entitlements.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No ride benefits assigned yet.</td>
                  </tr>
                ) : null}
                {result.value.data.entitlements.map((e) => (
                  <tr key={e.id} data-entitlement-id={e.id}>
                    <td>{e.guestId}</td>
                    <td>{e.householdId}</td>
                    <td>{e.program}</td>
                    <td>{e.amountNote ?? '—'}</td>
                    <td>{e.guestIsMinor ? 'minor (ineligible)' : 'adult'}</td>
                    <td>{e.status}</td>
                    <td>{e.claim ? `${e.claim.status} · ${e.claim.provider} · ${e.claim.redemptionKind}` : 'unclaimed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </Section>
          <Section title="Manual code pools">
          <ScrollRegion>
            <table className="ops-table con-table">
              <thead>
                <tr>
                  <th scope="col">Programme</th>
                  <th scope="col">Available</th>
                  <th scope="col">Issued</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.codePools.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No codes uploaded.</td>
                  </tr>
                ) : null}
                {result.value.data.codePools.map((p) => (
                  <tr key={p.program}>
                    <td>{p.program}</td>
                    <td>{p.available}</td>
                    <td>{p.issued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          </Section>
          <Section title="Change a benefit" id="benefit-forms">
            <AdminCapabilityForm
              capability="admin_assign_transportation_entitlement"
              title="Assign a ride benefit"
              submitLabel="Assign"
              fields={[
                { name: 'guestId', label: 'Guest id', type: 'text', required: true },
                { name: 'householdId', label: 'Household id', type: 'text', required: true },
                { name: 'program', label: 'Programme key', type: 'text', defaultValue: 'reception-ride-home', help: 'Lowercase letters, digits and dashes.' },
                { name: 'amountNote', label: 'Amount (as text)', type: 'text', help: 'From the planner (P-05). Shown to the guest verbatim.' },
                { name: 'validityNote', label: 'Validity (as text)', type: 'text' },
                { name: 'geofenceNote', label: 'Area (as text)', type: 'text' },
                { name: 'providerProgramRef', label: 'Provider programme reference', type: 'text', help: 'Uber voucher programme id, if any. Never a secret.' },
                { name: 'guestIsMinor', label: 'Guest is a minor (never eligible)', type: 'checkbox' },
              ]}
            />
            <AdminCapabilityForm
              capability="admin_revoke_transportation_entitlement"
              title="Revoke or reactivate"
              submitLabel="Apply"
              fields={[
                { name: 'entitlementId', label: 'Entitlement id', type: 'text', required: true },
                { name: 'status', label: 'Status', type: 'select', options: [{ value: 'revoked', label: 'Revoked' }, { value: 'active', label: 'Active' }], defaultValue: 'revoked' },
              ]}
            />
            <AdminCapabilityForm
              capability="admin_upload_transportation_codes"
              title="Upload manual ride codes"
              submitLabel="Upload"
              fields={[
                { name: 'program', label: 'Programme key', type: 'text', defaultValue: 'reception-ride-home' },
                { name: 'codes', label: 'Codes, one per line', type: 'lines', required: true, help: 'Sealed at rest on save. Duplicates are ignored. The codes are never displayed again.' },
              ]}
            />
          </Section>
        </>
      )}
    </ConsolePage>
  );
}
