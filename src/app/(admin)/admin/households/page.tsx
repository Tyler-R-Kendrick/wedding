import type { Metadata } from 'next';
import { deleteHousehold, saveHousehold } from '../_lib/actions';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Button, IdemKey, Input, OpsPage, Section, SignInRequired } from '../_components/ops';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Households', robots: { index: false, follow: false } };

type Household = { id: string; name: string; managerGuestId: string | null; memberCount: number; invitation: { status: string; tokenPrefix: string } | null };
type Detail = { household: Household & { mailingAddress: Record<string, string | undefined> | null; notes: string | null }; members: { id: string; displayName: string; kind: string; isMinor: boolean }[] };

export default async function HouseholdsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if ((await adminPrincipal()).kind !== 'admin') return <SignInRequired />;
  const list = await adminInvoke<{ households: Household[] }>('admin_list_households', { q: sp.q || undefined }, { method: 'GET' });
  const detail = sp.edit ? await adminInvoke<Detail>('admin_get_household', { householdId: sp.edit }, { method: 'GET' }) : null;
  const rows = list.ok ? list.value.data.households : [];
  const editing = detail?.ok ? detail.value.data : null;
  const a = editing?.household.mailingAddress ?? {};
  return (
    <OpsPage title="Households" lede="The RSVP unit. One manager per household; children and guests without email are managed by them." notice={{ ok: sp.ok, error: sp.error ?? (!list.ok ? list.error.message : undefined) }}>
      <Section title={editing ? `Edit ${editing.household.name}` : 'Add a household'}>
        <form action={saveHousehold} className="ops-form">
          <IdemKey />
          {editing ? <input type="hidden" name="id" value={editing.household.id} /> : null}
          <Input id="name" label="Name as printed" defaultValue={editing?.household.name} required />
          <Input
            id="managerGuestId"
            label="Household manager"
            defaultValue={editing?.household.managerGuestId ?? ''}
            options={[{ value: '', label: editing ? '— none —' : 'Add members first' }, ...(editing?.members.filter((m) => m.kind !== 'child' && !m.isMinor).map((m) => ({ value: m.id, label: m.displayName })) ?? [])]}
          />
          <Input id="line1" label="Address line 1" defaultValue={a.line1} />
          <Input id="line2" label="Address line 2" defaultValue={a.line2} />
          <Input id="city" label="City" defaultValue={a.city} />
          <Input id="region" label="State / region" defaultValue={a.region} />
          <Input id="postalCode" label="Postal code" defaultValue={a.postalCode} />
          <Input id="country" label="Country" defaultValue={a.country} />
          <Input id="notes" label="Admin notes (never shown to guests)" type="textarea" defaultValue={editing?.household.notes ?? ''} />
          <div className="ops-form-inline">
            <Button>{editing ? 'Save household' : 'Add household'}</Button>
            {editing ? <a href="/admin/households">Cancel</a> : null}
          </div>
        </form>
      </Section>
      <Section title="All households">
        <form method="get" className="ops-form-inline">
          <Input id="q" label="Search" defaultValue={sp.q} />
          <Button variant="ghost">Search</Button>
        </form>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Members</th>
                <th scope="col">Invitation</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{h.memberCount}</td>
                  <td>{h.invitation ? `${h.invitation.status} (${h.invitation.tokenPrefix}…)` : 'none'}</td>
                  <td>
                    <div className="ops-form-inline">
                      <a href={`/admin/households?edit=${encodeURIComponent(h.id)}`}>Edit</a>
                      <a href={`/admin/guests?householdId=${encodeURIComponent(h.id)}`}>Guests</a>
                      {h.memberCount === 0 ? (
                        <form action={deleteHousehold}>
                          <input type="hidden" name="householdId" value={h.id} />
                          <Button variant="danger">Delete</Button>
                        </form>
                      ) : null}
                    </div>
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
