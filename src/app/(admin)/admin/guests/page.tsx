import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { stopGuestView } from '@/components/guest-view/actions';
import { GUEST_VIEW_COOKIE, verifyGuestViewToken } from '@/domain/identity/guest-view';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { startGuestView } from '../_lib/guest-view-actions';
import { deleteGuest, importGuestsCsv, mergeGuests, rebindIdentity, resetIdentity, saveGuest, setAdminRole } from '../_lib/actions';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Button, Checkbox, ConfirmCheck, IdemKey, Input } from '../_components/ops';
import { ConsoleGate, ConsolePage, DataTable, Day, Note, Section } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guests', robots: { index: false, follow: false } };

type Guest = { id: string; householdId: string; householdName: string; firstName: string; lastName: string; displayName: string; email: string | null; kind: string; isMinor: boolean; managedByGuestId: string | null; mergedIntoGuestId: string | null; notes: string | null; claimed: boolean; claimedAt: string | null; claimMethod: string | null };

export default async function GuestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const principal = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Guests" />;
  const isOwner = principal.roles.has('owner');
  const own = await adminInvoke<{ records: { guestId: string; displayName: string }[] }>('admin_list_own_guest_records', {}, { method: 'GET' });
  const ownRecords = own.ok ? own.value.data.records : [];
  const browsing = verifyGuestViewToken((await cookies()).get(GUEST_VIEW_COOKIE)?.value, principal.sessionId, getPreviewSecret(), new Date());
  // An administrator without guest operations (a moderator) reaches this screen from "Browse as a
  // guest" too: they get the one section that is theirs, not a list they may not read.
  if (!principal.entitlements.has('admin_guest_ops')) {
    const browsingName = browsing ? (ownRecords.find((r) => r.guestId === browsing.guestId)?.displayName ?? 'a guest') : null;
    return (
      <ConsolePage title="Guests" lede="Browse the site as your own guest record." notice={{ ok: sp.ok, error: sp.error }}>
        <BrowseAs browsingName={browsingName} isOwner={isOwner} ownRecords={ownRecords} />
      </ConsolePage>
    );
  }
  // The checkbox submits `merged=on`; `1` is kept for links written by hand.
  const showMerged = sp.merged === 'on' || sp.merged === '1';
  const [list, hh] = await Promise.all([
    adminInvoke<{ guests: Guest[]; truncated: boolean }>('admin_list_guests', { q: sp.q || undefined, householdId: sp.householdId || undefined, includeMerged: showMerged }, { method: 'GET' }),
    adminInvoke<{ households: { id: string; name: string }[]; truncated: boolean }>('admin_list_households', {}, { method: 'GET' }),
  ]);
  const rows = list.ok ? list.value.data.guests : [];
  const households = hh.ok ? hh.value.data.households : [];
  const truncated = (list.ok && list.value.data.truncated) || (hh.ok && hh.value.data.truncated);
  const editing = sp.edit ? rows.find((g) => g.id === sp.edit) ?? null : null;
  // Browsing as anyone but yourself is for owners (`admin_browse_as_guest` re-checks it).
  const canBrowseAs = isOwner;
  const browsingName = browsing ? (rows.find((g) => g.id === browsing.guestId)?.displayName ?? ownRecords.find((r) => r.guestId === browsing.guestId)?.displayName ?? 'a guest') : null;
  return (
    <ConsolePage title="Guests" lede="People as printed on the invitations. Emails drive sign-in codes; notes stay admin-only; dietary and accessibility needs live with RSVP and are never exported here." notice={{ ok: sp.ok, error: sp.error ?? (!list.ok ? list.error.message : undefined) }}>
      {truncated ? <Note>There are more guests or households than this screen lists at once. Only the first {rows.length} guests and {households.length} households are shown; narrow the list with a search.</Note> : null}
      <BrowseAs browsingName={browsingName} isOwner={isOwner} ownRecords={ownRecords} />

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
          <Checkbox id="isMinor" label="Minor (never signs in)" defaultChecked={editing?.isMinor} />
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
          <Checkbox id="merged" label="Show merged duplicates" name="merged" defaultChecked={showMerged} />
          <Button variant="ghost">Search</Button>
          <a href="/admin/guests/export">Export CSV</a>
          <a href="/admin/guests/export?notes=1&address=1">Export CSV with notes + addresses</a>
        </form>
        <DataTable
          caption="Guests and the households they belong to"
          dense={false}
          empty={rows.length === 0 ? <>No guest matches this search.</> : null}
          head={
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Household</th>
              <th scope="col">Kind</th>
              <th scope="col">Email</th>
              <th scope="col">Access</th>
              <th scope="col">Actions</th>
            </tr>
          }
        >
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.displayName}
                    {g.mergedIntoGuestId ? ' (merged)' : ''}
                  </td>
                  <td>{g.householdName}</td>
                  <td>{g.kind}{g.isMinor ? ' · minor' : ''}</td>
                  <td>{g.email ?? '—'}</td>
                  <td>{g.claimed ? <>claimed <Day at={g.claimedAt} /> ({g.claimMethod})</> : 'not claimed'}</td>
                  <td>
                    <div className="ops-form-inline">
                      <a href={`/admin/guests?edit=${encodeURIComponent(g.id)}${sp.householdId ? `&householdId=${encodeURIComponent(sp.householdId)}` : ''}`}>Edit</a>
                      {canBrowseAs && !g.mergedIntoGuestId && g.kind !== 'child' && !g.isMinor ? (
                        <form action={startGuestView}>
                          <input type="hidden" name="guestId" value={g.id} />
                          <Button variant="ghost">
                            Browse as <span className="sr-only">{g.displayName}</span>
                          </Button>
                        </form>
                      ) : null}
                      {g.claimed ? (
                        <form action={resetIdentity}>
                          <input type="hidden" name="guestId" value={g.id} />
                          <input type="hidden" name="reason" value="admin reset from guests page" />
                          <ConfirmCheck id={`confirm-reset-${g.id}`} label={`Yes, reset ${g.displayName}’s access`} />
                          <Button variant="danger">Reset access</Button>
                        </form>
                      ) : (
                        <form action={deleteGuest}>
                          <input type="hidden" name="guestId" value={g.id} />
                          <ConfirmCheck id={`confirm-delete-${g.id}`} label={`Yes, delete ${g.displayName}`} />
                          <Button variant="danger">Delete</Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
        </DataTable>
      </Section>

      <Section title="Move a guest’s access to another email (rebind)">
        <form action={rebindIdentity} className="ops-form">
          <Input id="rebind-guest" label="Guest id" name="guestId" required />
          <Input id="rebind-email" label="New email" name="email" type="email" required />
          <Input id="rebind-reason" label="Reason (audited)" name="reason" required />
          <ConfirmCheck id="confirm-rebind" label="Yes, move this guest’s access to the new email (the old one stops working)" />
          <div>
            <Button>Rebind</Button>
          </div>
        </form>
      </Section>

      <Section title="Merge duplicates">
        <form action={mergeGuests} className="ops-form">
          <Input id="keepId" label="Guest id to keep" required />
          <Input id="mergeId" label="Duplicate guest id to merge" required />
          <ConfirmCheck id="confirm-merge" label="Yes, merge the duplicate into the guest I keep" />
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
            <ConfirmCheck id="confirm-role" label="Yes, change what this person can do in the console" />
            <div>
              <Button>Save role</Button>
            </div>
          </form>
        </Section>
      ) : null}
    </ConsolePage>
  );
}

/**
 * "Browse the site as a guest": the current view and the way to stop it, the administrator's own
 * guest records (anyone may browse as theirs), and, for owners, the pointer to the per-row buttons.
 */
function BrowseAs({ browsingName, isOwner, ownRecords }: { browsingName: string | null; isOwner: boolean; ownRecords: { guestId: string; displayName: string }[] }) {
  return (
    <Section title="Browse the site as a guest" id="browse-as">
      <p className="con-note">
        See the site the way one guest does: their account menu, their weekend, their RSVP and table, in this browser only. Anyone else’s view is read-only: nothing you do there is saved or sent in their
        name, and their ride credit and the concierge stay closed. A band on every page says whose view it is, with the way to stop.
      </p>
      {browsingName ? (
        <div className="ops-form-inline">
          <p className="con-note">
            You are browsing the site as <strong>{browsingName}</strong>. The console still shows you as yourself.
          </p>
          <a href="/">Open the site</a>
          <form action={stopGuestView}>
            <Button variant="ghost">Stop browsing as {browsingName}</Button>
          </form>
        </div>
      ) : null}
      {ownRecords.length ? (
        <div className="ops-form-inline">
          {ownRecords.map((r) => (
            <form key={r.guestId} action={startGuestView}>
              <input type="hidden" name="guestId" value={r.guestId} />
              <Button variant="ghost">Browse as yourself ({r.displayName})</Button>
            </form>
          ))}
        </div>
      ) : null}
      <p className="con-note">
        {isOwner
          ? 'Choose “Browse as” beside a guest in the list below.'
          : ownRecords.length
            ? 'Browsing as anyone else is for the site’s owners: a view reads everything that guest can, which reaches past what this role’s screens show.'
            : 'You have no guest record of your own on the list, and browsing as anyone else is for the site’s owners: a view reads everything that guest can, which reaches past what this role’s screens show.'}
      </p>
    </Section>
  );
}
