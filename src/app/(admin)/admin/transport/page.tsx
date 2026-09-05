import { adminListTransportationEntitlements } from '@/capabilities/admin_transport';
import { AdminCapabilityForm } from '@/components/handoff/AdminCapabilityForm';
import { invokeForPage } from '@/components/handoff/server';
import { AdminShell, ScrollRegion, SECTION_TITLE, TABLE, TD, TH } from '../_shared';

export const dynamic = 'force-dynamic';

/** Ride benefits: assignment and eligibility, manual code upload (counts only), claim status. Never a code or link. */
export default async function AdminTransportPage() {
  const { principal, result } = await invokeForPage(adminListTransportationEntitlements, {});
  return (
    <AdminShell title="Ride benefits" principal={principal}>
      {!result.ok ? (
        <p className="mt-4">{result.error.message}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-primary/70">
            Provider: {result.value.data.provider.name} ({result.value.data.provider.mode}). Codes and redemption links are sealed and never shown here.
          </p>
          <h2 className={SECTION_TITLE}>Entitlements and claims</h2>
          <ScrollRegion label="Entitlements and claims">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Guest</th>
                  <th className={TH} scope="col">Household</th>
                  <th className={TH} scope="col">Programme</th>
                  <th className={TH} scope="col">Amount</th>
                  <th className={TH} scope="col">Eligibility</th>
                  <th className={TH} scope="col">Status</th>
                  <th className={TH} scope="col">Claim</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.entitlements.length === 0 ? (
                  <tr>
                    <td className={TD} colSpan={7}>No ride benefits assigned yet.</td>
                  </tr>
                ) : null}
                {result.value.data.entitlements.map((e) => (
                  <tr key={e.id} data-entitlement-id={e.id}>
                    <td className={TD}>{e.guestId}</td>
                    <td className={TD}>{e.householdId}</td>
                    <td className={TD}>{e.program}</td>
                    <td className={TD}>{e.amountNote ?? '—'}</td>
                    <td className={TD}>{e.guestIsMinor ? 'minor (ineligible)' : 'adult'}</td>
                    <td className={TD}>{e.status}</td>
                    <td className={TD}>{e.claim ? `${e.claim.status} · ${e.claim.provider} · ${e.claim.redemptionKind}` : 'unclaimed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <h2 className={SECTION_TITLE}>Manual code pools</h2>
          <ScrollRegion label="Manual code pools">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH} scope="col">Programme</th>
                  <th className={TH} scope="col">Available</th>
                  <th className={TH} scope="col">Issued</th>
                </tr>
              </thead>
              <tbody>
                {result.value.data.codePools.length === 0 ? (
                  <tr>
                    <td className={TD} colSpan={3}>No codes uploaded.</td>
                  </tr>
                ) : null}
                {result.value.data.codePools.map((p) => (
                  <tr key={p.program}>
                    <td className={TD}>{p.program}</td>
                    <td className={TD}>{p.available}</td>
                    <td className={TD}>{p.issued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
          <div className="mt-10 grid gap-8">
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
          </div>
        </>
      )}
    </AdminShell>
  );
}
