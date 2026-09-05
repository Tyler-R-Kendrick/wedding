import type { Metadata } from 'next';
import { revokeInvitation } from '../_lib/actions';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Button, Input, OpsPage, Section, SignInRequired } from '../_components/ops';
import { IssueForm } from './IssueForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invitations', robots: { index: false, follow: false } };

type Inv = { id: string; householdId: string; householdName: string; tokenPrefix: string; status: string; lifecycle: string; issuedAt: string; expiresAt: string; claimedAt: string | null; revokedReason: string | null; eventKeys: string[]; plusOneAllowance: number; childrenAllowance: number };

export default async function InvitationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if ((await adminPrincipal()).kind !== 'admin') return <SignInRequired />;
  const [inv, hh] = await Promise.all([
    adminInvoke<{ invitations: Inv[] }>('admin_list_invitations', {}, { method: 'GET' }),
    adminInvoke<{ households: { id: string; name: string }[] }>('admin_list_households', {}, { method: 'GET' }),
  ]);
  const notice = { ok: sp.ok, error: sp.error ?? (!inv.ok ? inv.error.message : undefined) };
  const rows = inv.ok ? inv.value.data.invitations : [];
  const households = hh.ok ? hh.value.data.households : [];
  return (
    <OpsPage title="Invitations" lede="Links are discovery only: they show who is invited and start a claim. Tokens are never stored; rotate a link if it leaks." notice={notice}>
      <Section title="Issue a link">
        <IssueForm households={households} />
      </Section>
      <Section title="All links">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Household</th>
                <th scope="col">Prefix</th>
                <th scope="col">Status</th>
                <th scope="col">Events</th>
                <th scope="col">Expires</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.householdName}</td>
                  <td className="ops-code">{r.tokenPrefix}…</td>
                  <td>
                    {r.lifecycle}
                    {r.claimedAt ? ` · claimed ${new Date(r.claimedAt).toLocaleDateString('en-US')}` : ''}
                    {r.revokedReason ? ` · ${r.revokedReason}` : ''}
                  </td>
                  <td>{r.eventKeys.join(', ') || '—'}</td>
                  <td>{new Date(r.expiresAt).toLocaleDateString('en-US')}</td>
                  <td>
                    {r.lifecycle !== 'revoked' ? (
                      <div className="ops-form-inline">
                        <IssueForm households={households} rotateId={r.id} />
                        <form action={revokeInvitation} className="ops-form-inline">
                          <input type="hidden" name="invitationId" value={r.id} />
                          <Input id={`reason-${r.id}`} label="Reason" name="reason" defaultValue="revoked by admin" />
                          <Button variant="danger">Revoke</Button>
                        </form>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </OpsPage>
  );
}
