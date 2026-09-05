import type { Metadata } from 'next';
import { deleteGuest, importGuestsCsv, mergeGuests, rebindIdentity, resetIdentity, saveGuest, setAdminRole } from '../_lib/actions';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Button, Checkbox, IdemKey, Input, OpsPage, Section, SignInRequired } from '../_components/ops';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guests', robots: { index: false, follow: false } };

type Guest = { id: string; householdId: string; householdName: string; firstName: string; lastName: string; displayName: string; email: string | null; kind: string; isMinor: boolean; managedByGuestId: string | null; mergedIntoGuestId: string | null; notes: string | null; claimed: boolean; claimedAt: string | null; claimMethod: string | null };

export default async function GuestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const principal = await adminPrincipal();
  if (principal.kind !== 'admin') return <SignInRequired />;
  const [list, hh] = await Promise.all([
    adminInvoke<{ guests: Guest[] }>('admin_list_guests', { q: sp.q || undefined, householdId: sp.householdId || undefined, includeMerged: sp.merged === '1' }, { method: 'GET' }),
    adminInvoke<{ households: { id: string; name: string }[] }>('admin_list_households', {}, { method: 'GET' }),
  ]);
  const rows = list.ok ? list.value.data.guests : [];
  const households = hh.ok ? hh.value.data.households : [];
  const editing = sp.edit ? rows.find((g) => g.id === sp.edit) ?? null : null;
  const isOwner = principal.roles.has('owner');
  return (
    <OpsPage title="Guests" lede="People as printed on the invitations. Emails drive sign-in codes; notes stay admin-only; dietary and accessibility needs live with RSVP and are never exported here." notice={{ ok: sp.ok, error: sp.error ?? (!list.ok ? list.error.message : undefined) }}>
      <Section title={editing ? `Edit ${editing.displayName}` : 'Add a guest'}>
        <form action={saveGuest} className="ops-form">
          <IdemKey />
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <Input id="householdId" label="Household" defaultValue={editing?.householdId ?? sp.householdId} required options={households.map((h) => ({ value: h.id, label: h.name }))} />
          <Input id="firstName" label="First name" defaultValue={editing?.firstName} required />
          <Input id="lastName" label="Last name" defaultValue={editing?.lastName} />
          <Input id="email" label="Email" type="email" defaultValue={editing?.email ?? ''} hint="Optional. Codes go here." />
          <Input id="kind" label="Kind" defaultValue={editing?.kind ?? 'adult'} options={[{ value: 'adult', label: 'Adult' }, { value: 'child', label: 'Child' }, { value: 'plus_one', label: 'Plus-one' }]} />
          <Input id="managedByGuestId" label="Managed by (guest id)" defaultValue={editing?.managedByGuestId ?? ''} hint="Leave blank to use the household manager." />
          <Checkbox id="isMinor" label="Minor (never signs in)" />
          <Input id="notes" label="Admin notes" type="textarea" defaultValue={editing?.notes ?? ''} />
          <div className="ops-form-inline">
            <Button>{editing ? 'Save guest' : 'Add guest'}</Button>
            {editing ? <a href="/admin/guests">Cancel</a> : null}
          </div>
        </form>
      </Section>

      <Section title="All guests">
        <form method="get" className="ops-form-inline">
          <Input id="q" label="Search name or email" defaultValue={sp.q} />
          <Checkbox id="merged" label="Show merged duplicates" name="merged" />
          <Button variant="ghost">Search</Button>
          <a href="/admin/guests/export">Export CSV</a>
          <a href="/admin/guests/export?notes=1&address=1">Export CSV with notes + addresses</a>
        </form>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Household</th>
                <th scope="col">Kind</th>
                <th scope="col">Email</th>
                <th scope="col">Access</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.displayName}
                    {g.mergedIntoGuestId ? ' (merged)' : ''}
                  </td>
                  <td>{g.householdName}</td>
                  <td>{g.kind}{g.isMinor ? ' · minor' : ''}</td>
                  <td>{g.email ?? '—'}</td>
                  <td>{g.claimed ? `claimed ${g.claimedAt ? new Date(g.claimedAt).toLocaleDateString('en-US') : ''} (${g.claimMethod})` : 'not claimed'}</td>
                  <td>
                    <div className="ops-form-inline">
                      <a href={`/admin/guests?edit=${encodeURIComponent(g.id)}${sp.householdId ? `&householdId=${encodeURIComponent(sp.householdId)}` : ''}`}>Edit</a>
                      {g.claimed ? (
                        <form action={resetIdentity}>
                          <input type="hidden" name="guestId" value={g.id} />
                          <input type="hidden" name="reason" value="admin reset from guests page" />
                          <Button variant="danger">Reset access</Button>
                        </form>
                      ) : (
                        <form action={deleteGuest}>
                          <input type="hidden" name="guestId" value={g.id} />
                          <Button variant="danger">Delete</Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Move a guest’s access to another email (rebind)">
        <form action={rebindIdentity} className="ops-form">
          <Input id="rebind-guest" label="Guest id" name="guestId" required />
          <Input id="rebind-email" label="New email" name="email" type="email" required />
          <Input id="rebind-reason" label="Reason (audited)" name="reason" required />
          <div>
            <Button>Rebind</Button>
          </div>
        </form>
      </Section>

      <Section title="Merge duplicates">
        <form action={mergeGuests} className="ops-form">
          <Input id="keepId" label="Guest id to keep" required />
          <Input id="mergeId" label="Duplicate guest id to merge" required />
          <div>
            <Button variant="danger">Merge</Button>
          </div>
        </form>
      </Section>

      <Section title="Import CSV">
        <form action={importGuestsCsv} className="ops-form">
          <Input id="csv" label="CSV" type="textarea" hint="Columns: household, first_name, last_name, email, kind, is_minor, manager, plus_one_of, event_keys, notes, address_line1…" required />
          <Checkbox id="dryRun" label="Dry run (report only)" />
          <div>
            <Button>Import</Button>
          </div>
        </form>
      </Section>

      {isOwner ? (
        <Section title="Administrator roles">
          <form action={setAdminRole} className="ops-form">
            <Input id="role-email" label="Email" name="email" type="email" required />
            <Input id="role" label="Role" defaultValue="planner" options={[{ value: 'owner', label: 'Owner' }, { value: 'planner', label: 'Planner' }, { value: 'moderator', label: 'Moderator' }, { value: 'none', label: 'Remove role' }]} />
            <div>
              <Button>Save role</Button>
            </div>
          </form>
        </Section>
      ) : null}
    </OpsPage>
  );
}
