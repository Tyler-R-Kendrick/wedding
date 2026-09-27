import type { Metadata } from 'next';
import { FilterBar } from '@/components/admin/flow/records';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { hasEntitlement } from '@/contracts/principal';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Checkbox } from '../_components/ops';
import { ConsoleGate, ConsolePage, DataTable, Note, Section, Stamp } from '../_components/console';
import { IssueLinkFlow } from './_components/InvitationFlows';
import { InvitationList, type InvitationRowView } from './_components/InvitationList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invitations', robots: { index: false, follow: false } };

type Inv = {
  id: string;
  householdId: string;
  householdName: string;
  tokenPrefix: string;
  status: string;
  lifecycle: 'active' | 'claimed' | 'expired' | 'revoked';
  issuedAt: string;
  expiresAt: string;
  claimedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  eventKeys: string[];
  plusOneAllowance: number;
  childrenAllowance: number;
  rotatedFromId: string | null;
};

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: WEDDING_TIMEZONE, year: 'numeric', month: 'short', day: 'numeric' });
const day = (iso: string) => ({ iso, label: DAY.format(new Date(iso)) });
const count = (n: number, one: string, many: string) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);

/**
 * Invitation links: make one for a household, replace one that leaked, revoke one that went astray.
 *
 * Each is a flow from the kit (`components/admin/flow/CONVENTIONS.md`). Making and replacing a link
 * end on the flow's Done panel, which is the only place the link and its QR code are ever shown: the
 * token is not stored, so a link that is lost is replaced, never looked up. The row actions used to be
 * a confirm box, a reason box and a red button repeated down every row, and the whole issue form a
 * second time per row to rotate it.
 */
export default async function InvitationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const principal = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Invitations" />;
  const [inv, hh, ev] = await Promise.all([
    adminInvoke<{ invitations: Inv[]; truncated: boolean }>('admin_list_invitations', {}, { method: 'GET' }),
    adminInvoke<{ households: { id: string; name: string }[]; truncated: boolean }>('admin_list_households', {}, { method: 'GET' }),
    // Needs content access as well as guest access; without it the flow asks for event keys as text.
    hasEntitlement(principal, 'admin_content') ? adminInvoke<{ events: { slug: string; name: string }[] }>('admin_list_events', {}, { method: 'GET' }) : null,
  ]);
  const rows = inv.ok ? inv.value.data.invitations : [];
  const households = (hh.ok ? hh.value.data.households : []).map((h) => ({ value: h.id, label: h.name }));
  const events = ev?.ok && ev.value.data.events.length ? ev.value.data.events.map((e) => ({ value: e.slug, label: e.name })) : null;
  const eventName = (k: string) => events?.find((e) => e.value === k)?.label ?? k;
  const known = events?.map((e) => e.value) ?? ['ceremony', 'reception'];
  const usual = known.filter((k) => k === 'ceremony' || k === 'reception');
  const defaultEvents = usual.length ? usual : known;
  const showRevoked = sp.revoked === 'on';

  const view: InvitationRowView[] = rows.map((r) => ({
    id: r.id,
    householdName: r.householdName || 'A household no longer on the list',
    tokenPrefix: `${r.tokenPrefix}…`,
    lifecycle: r.lifecycle,
    revokedReason: r.revokedReason,
    rotatedFromId: r.rotatedFromId,
    events: r.eventKeys.map(eventName).join(', ') || 'no events',
    allowances: `${count(r.plusOneAllowance, 'plus-one', 'plus-ones')}, ${count(r.childrenAllowance, 'child', 'children')}`,
    expires: day(r.expiresAt),
    claimed: r.claimedAt ? day(r.claimedAt) : null,
  }));

  return (
    <ConsolePage
      title="Invitations"
      lede="Each household’s link to its invitation. A link shows who is invited and lets them claim their place; it is shown once when made, and replaced if it leaks or is lost."
      notice={{ error: !inv.ok ? inv.error.message : undefined }}
      actions={<IssueLinkFlow households={households} events={events} defaultEvents={defaultEvents} />}
    >
      {(inv.ok && inv.value.data.truncated) || (hh.ok && hh.value.data.truncated) ? (
        <Note>There are more links or households than this screen lists at once. Only the first {rows.length} links and {households.length} households are shown.</Note>
      ) : null}
      <Section title="Links" id="links">
        <FilterBar submitLabel="Show">
          <Checkbox id="revoked" name="revoked" label="Show replaced and revoked links" defaultChecked={showRevoked} />
        </FilterBar>
        <InvitationList rows={view} showRevoked={showRevoked} />
      </Section>

      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <Note>Every link as saved, including replaced and revoked ones. The token itself is never stored: only its first characters, to tell links apart.</Note>
          <DataTable
            caption="Invitation links, as saved"
            empty={rows.length ? null : 'None saved.'}
            head={
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Household id</th>
                <th scope="col">Starts with</th>
                <th scope="col">Status</th>
                <th scope="col">Issued</th>
                <th scope="col">Revoked</th>
                <th scope="col">Replaces</th>
              </tr>
            }
          >
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.householdId}</td>
                <td className="ops-code">{r.tokenPrefix}…</td>
                <td>{r.status}</td>
                <td>
                  <Stamp at={r.issuedAt} />
                </td>
                <td>{r.revokedAt ? <Stamp at={r.revokedAt} /> : '—'}</td>
                <td>{r.rotatedFromId ?? '—'}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
