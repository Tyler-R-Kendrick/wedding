import type { Metadata } from 'next';
import { adminListGuests } from '@/capabilities/admin_guest_ops';
import { adminListTransportationEntitlements } from '@/capabilities/admin_transport';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { invokeForPage } from '@/components/handoff/server';
import { hasEntitlement } from '@/contracts/principal';
import { DEFAULT_PROGRAM } from '@/domain/transport';
import { ConsoleGate, ConsolePage, DataTable, Day, Note, Pill, Section } from '../_components/console';
import { AssignRideFlow, RevokeRideFlow, UploadCodesFlow, type GuestOption } from './_components/TransportFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ride benefits (admin)', robots: { index: false, follow: false } };

const CLAIM: Record<string, string> = { pending: 'claim in progress', issued: 'ride claimed', failed: 'claim failed', revoked: 'claim withdrawn' };

/**
 * Ride benefits: who has one, whether they have claimed it, and the codes left to hand out. Never a
 * code or a redemption link: codes are sealed at rest and the list capability returns counts only.
 *
 * Three forms used to sit at the bottom of this page, asking for guest, household and entitlement
 * ids to be typed in. Each is now a flow from the kit: give a benefit (the page's main action),
 * change or withdraw one from its row, reactivate one with a click, and add codes to a pool.
 */
export default async function AdminTransportPage() {
  const { principal, result } = await invokeForPage(adminListTransportationEntitlements, {});
  // ConsolePage is a frame, so the gate is the route's own first statement — visible where the
  // authorization decision is made.
  if (principal.kind !== 'admin') return <ConsoleGate what="Transport" />;
  if (!result.ok) {
    return (
      <ConsolePage title="Ride benefits">
        <Note>{result.error.message}</Note>
      </ConsolePage>
    );
  }
  const { result: guestList } = await invokeForPage(adminListGuests, {});
  const guests = guestList.ok ? guestList.value.data.guests.filter((g) => !g.mergedIntoGuestId) : [];
  const byId = new Map(guests.map((g) => [g.id, g]));
  const options: GuestOption[] = guests.map((g) => ({
    value: g.id,
    label: `${g.displayName} (${g.householdName})`,
    householdId: g.householdId,
    minor: g.isMinor || g.kind === 'child',
  }));
  const { entitlements, codePools, provider } = result.value.data;
  const canUpload = hasEntitlement(principal, 'admin_integrations');
  const nameOf = (id: string) => byId.get(id)?.displayName ?? 'A guest no longer on the list';

  return (
    <ConsolePage
      title="Ride benefits"
      lede={`A ride home, paid for by you, through ${provider.name}. Codes and redemption links are sealed and never shown here.`}
      actions={<AssignRideFlow guests={options} defaultProgram={DEFAULT_PROGRAM} label="Give a guest a ride" />}
    >
      {!guestList.ok ? <Note>The guest list could not be read, so guests are shown by id: {guestList.error.message}</Note> : null}

      <Section title="Who has a ride benefit" id="benefits">
        <RecordList label="Ride benefits" empty={entitlements.length ? null : 'Nobody has a ride benefit yet.'}>
          {entitlements.map((e) => {
            const name = byId.has(e.guestId) ? nameOf(e.guestId) : e.guestId;
            const ride = {
              id: e.id,
              guestId: e.guestId,
              guestName: name,
              householdId: e.householdId,
              program: e.program,
              amountNote: e.amountNote,
              validityNote: e.validityNote,
              geofenceNote: e.geofenceNote,
              providerProgramRef: e.providerProgramRef,
              validFrom: e.validFrom,
              validUntil: e.validUntil,
              verifiedAt: e.verifiedAt,
            };
            return (
              <RecordRow
                key={e.id}
                data-entitlement-id={e.id}
                title={name}
                status={
                  <>
                    {e.status === 'active' ? <Pill tone="good">Active</Pill> : <Pill>Withdrawn</Pill>}{' '}
                    {e.guestIsMinor ? <Pill tone="warn">A minor, cannot claim</Pill> : null}
                  </>
                }
                meta={
                  <>
                    {byId.get(e.guestId)?.householdName ?? 'Household not found'} · {e.amountNote ?? 'no amount set'} · {e.claim ? CLAIM[e.claim.status] ?? e.claim.status : 'not claimed yet'}
                    {e.claim?.claimedAt ? (
                      <>
                        {' '}
                        <Day at={e.claim.claimedAt} />
                      </>
                    ) : null}
                  </>
                }
                actions={
                  e.status === 'active' ? (
                    <>
                      <AssignRideFlow guests={options} ride={ride} defaultProgram={DEFAULT_PROGRAM} variant="quiet" label="Change" accessibleName={`Change ${name}’s ride benefit`} />
                      <RevokeRideFlow ride={ride} />
                    </>
                  ) : (
                    <QuickAction
                      label="Reactivate"
                      busyLabel="Reactivating…"
                      done={`${name}’s ride benefit is active again.`}
                      accessibleName={`Reactivate ${name}’s ride benefit`}
                      calls={[{ capability: 'admin_revoke_transportation_entitlement', input: { entitlementId: e.id, status: 'active' } }]}
                    />
                  )
                }
              />
            );
          })}
        </RecordList>
      </Section>

      <Section title="Ride codes" id="codes" note="Codes you add from Uber, handed out one per claim. Only the counts are shown.">
        <DataTable
          caption="Codes by programme"
          empty={codePools.length ? null : 'No codes added yet.'}
          head={
            <tr>
              <th scope="col">Programme</th>
              <th scope="col">Left to hand out</th>
              <th scope="col">Handed out</th>
            </tr>
          }
        >
          {codePools.map((p) => (
            <tr key={p.program}>
              <td>{p.program}</td>
              <td>{p.available}</td>
              <td>{p.issued}</td>
            </tr>
          ))}
        </DataTable>
        {canUpload ? <UploadCodesFlow defaultProgram={DEFAULT_PROGRAM} /> : <Note>Adding codes needs the integrations entitlement; the owner can grant it.</Note>}
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>
            Provider: {provider.name} ({provider.mode}). The rows as saved, for troubleshooting; nothing here needs changing by hand.
          </Note>
          <DataTable
            caption="Ride benefits, as saved"
            empty={entitlements.length ? null : 'None saved.'}
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Guest id</th>
                <th scope="col">Household id</th>
                <th scope="col">Programme</th>
                <th scope="col">Uber reference</th>
                <th scope="col">Claim</th>
              </tr>
            }
          >
            {entitlements.map((e) => (
              <tr key={e.id}>
                <td>{e.id}</td>
                <td>{e.guestId}</td>
                <td>{e.householdId}</td>
                <td>{e.program}</td>
                <td>{e.providerProgramRef ?? '—'}</td>
                <td>{e.claim ? `${e.claim.status} · ${e.claim.provider} · ${e.claim.redemptionKind}` : 'unclaimed'}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
