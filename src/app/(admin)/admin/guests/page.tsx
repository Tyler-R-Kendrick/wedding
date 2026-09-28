import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { stopGuestView } from '@/components/guest-view/actions';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';
import { startGuestView } from '../_lib/guest-view-actions';
import { ListsProvider } from '@/components/admin/flow/lists';
import { PageLinks, paged } from '@/components/admin/flow/paging';
import { FilterBar, RecordList, RecordRow } from '@/components/admin/flow/records';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Checkbox, Input } from '../_components/ops';
import { ConsoleGate, ConsolePage, Day, Note, Pill, Section } from '../_components/console';
import { AdminRoleFlow, DeleteGuestFlow, GuestFlow, ImportGuestsFlow, MergeFlow, RebindFlow, ResetAccessFlow, type GuestSummary } from './_components/GuestFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guests', robots: { index: false, follow: false } };

type Guest = GuestSummary & { mergedIntoGuestId: string | null; claimedAt: string | null; claimMethod: string | null };

/**
 * Guests: the people on the invitations.
 *
 * Adding, editing, deleting, resetting access, moving access to a new email, merging duplicates,
 * importing a list and changing console roles are each a flow from the kit
 * (`components/admin/flow/CONVENTIONS.md`). They replace a form at the top of the page that
 * `?edit=` refilled, a confirm box and red button in every row, and three forms at the bottom that
 * asked for guest ids to be typed in.
 */
export default async function GuestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const principal = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Guests" />;
  const isOwner = principal.roles.has('owner');
  const own = await adminInvoke<{ records: { guestId: string; displayName: string }[] }>('admin_list_own_guest_records', {}, { method: 'GET' });
  const ownRecords = own.ok ? own.value.data.records : [];
  // Whose view this browser is in, named by the capability whatever the list below is filtered to.
  const status = await adminInvoke<{ view: { displayName: string } | null }>('admin_guest_view_status', { token: (await cookies()).get(GUEST_VIEW_COOKIE)?.value }, { method: 'GET' });
  const browsingName = status.ok ? (status.value.data.view?.displayName ?? null) : null;
  // An administrator without guest operations (a moderator) reaches this screen from "Browse as a
  // guest" too: they get the one section that is theirs, not a list they may not read.
  if (!principal.entitlements.has('admin_guest_ops')) {
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
  const shown = paged(rows, sp.page);
  const households = (hh.ok ? hh.value.data.households : []).map((h) => ({ value: h.id, label: h.name }));
  const truncated = (list.ok && list.value.data.truncated) || (hh.ok && hh.value.data.truncated);
  const household = sp.householdId ? households.find((h) => h.value === sp.householdId) : undefined;
  const mergeTargets = rows.filter((g) => !g.mergedIntoGuestId).map((g) => ({ value: g.id, label: `${g.displayName} (${g.householdName})` }));
  // Browsing as anyone but yourself is for owners (`admin_browse_as_guest` re-checks it). It sets a
  // cookie and opens the site, so it stays a plain form action rather than a flow.
  const canBrowseAs = isOwner;

  return (
    <ConsolePage
      title="Guests"
      lede="People as printed on the invitations. Emails drive sign-in codes; notes stay admin-only; dietary and accessibility needs live with RSVP and are never exported here."
      notice={{ ok: sp.ok, error: sp.error ?? (!list.ok ? list.error.message : undefined) }}
      actions={
        <>
          <GuestFlow households={households} defaultHouseholdId={sp.householdId} label="Add a guest" />
          <ImportGuestsFlow />
        </>
      }
    >
      {truncated ? <Note>There are more guests or households than this screen lists at once. Only the first {rows.length} guests and {households.length} households are shown; narrow the list with a search.</Note> : null}
      <BrowseAs browsingName={browsingName} isOwner={isOwner} ownRecords={ownRecords} />

      <Section title={household ? `Guests in ${household.label}` : 'All guests'} id="guests">
        <FilterBar
          extra={
            <>
              <a href="/admin/guests/export">Export CSV</a>
              <a href="/admin/guests/export?notes=1&address=1">Export with notes and addresses</a>
              {household ? <a href="/admin/guests">Show every household</a> : null}
            </>
          }
        >
          {sp.householdId ? <input type="hidden" name="householdId" value={sp.householdId} /> : null}
          <Input id="q" label="Search name or email" defaultValue={sp.q} />
          <Checkbox id="merged" label="Show merged duplicates" name="merged" defaultChecked={showMerged} />
        </FilterBar>
        <ListsProvider lists={{ households, guests: mergeTargets }}>
          <RecordList label="Guests" empty={rows.length === 0 ? 'No guest matches this search.' : null}>
            {shown.rows.map((g) => (
              <RecordRow
                key={g.id}
                data-guest-id={g.id}
                title={g.displayName}
                status={
                  g.mergedIntoGuestId ? (
                    <Pill>Merged</Pill>
                  ) : g.claimed ? (
                    <Pill tone="good">Signed in</Pill>
                  ) : (
                    <Pill>Not signed in yet</Pill>
                  )
                }
                meta={
                  <>
                    {g.householdName} · {g.kind === 'plus_one' ? 'plus-one' : g.kind}
                    {g.isMinor ? ', a minor' : ''} · {g.email ?? 'no email'}
                    {g.claimed && g.claimedAt ? (
                      <>
                        {' '}
                        · claimed <Day at={g.claimedAt} />
                      </>
                    ) : null}
                  </>
                }
                actions={
                  g.mergedIntoGuestId ? null : (
                    <>
                      <GuestFlow guest={g} label="Edit" variant="quiet" />
                      {g.claimed ? <RebindFlow guest={g} /> : null}
                      <MergeFlow guest={g} />
                      {canBrowseAs && g.kind !== 'child' && !g.isMinor ? (
                        <form action={startGuestView} className="flow-inline-form">
                          <input type="hidden" name="guestId" value={g.id} />
                          <button type="submit" className="flow-trigger-quiet">
                            Browse as <span className="sr-only">{g.displayName}</span>
                          </button>
                        </form>
                      ) : null}
                      {g.claimed ? <ResetAccessFlow guest={g} /> : <DeleteGuestFlow guest={g} />}
                    </>
                  )
                }
              />
            ))}
          </RecordList>
        </ListsProvider>
        <PageLinks paging={shown} path="/admin/guests" params={sp} noun="guests" anchor="guests" />
      </Section>

      {isOwner ? (
        <Section title="Who can use this console" id="roles" note="Owners only. Changing someone’s access asks you to confirm it’s you first.">
          <AdminRoleFlow />
        </Section>
      ) : null}
    </ConsolePage>
  );
}

/**
 * "Browse the site as a guest": the current view and the way to stop it, the administrator's own
 * guest records (anyone may browse as theirs), and, for owners, the pointer to the per-row buttons.
 * The buttons are plain form actions: they set or clear a cookie and open the site or the console.
 */
function BrowseAs({ browsingName, isOwner, ownRecords }: { browsingName: string | null; isOwner: boolean; ownRecords: { guestId: string; displayName: string }[] }) {
  return (
    <Section title="Browse the site as a guest" id="browse-as">
      <p className="con-note">
        See the site the way one guest does: their account menu, their weekend, their RSVP and table, in this browser only. Anyone else’s view is read-only: nothing you do there is saved or sent in their
        name, and their ride credit and the concierge stay closed. A band on every page says whose view it is, with the way to stop.
      </p>
      {browsingName ? (
        // A <div>, not a paragraph: a form cannot sit inside one.
        <div className="con-note">
          You are browsing the site as <strong>{browsingName}</strong>. The console still shows you as yourself. <a href="/">Open the site</a>{' '}
          <form action={stopGuestView} className="flow-inline-form">
            <button type="submit" className="ops-button ops-button-ghost">
              Stop browsing as {browsingName}
            </button>
          </form>
        </div>
      ) : null}
      {ownRecords.length ? (
        <div className="con-note">
          {ownRecords.map((r) => (
            <form key={r.guestId} action={startGuestView} className="flow-inline-form">
              <input type="hidden" name="guestId" value={r.guestId} />
              <button type="submit" className="ops-button ops-button-ghost">
                Browse as yourself ({r.displayName})
              </button>
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
