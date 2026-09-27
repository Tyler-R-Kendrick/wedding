import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { stopGuestView } from '@/components/guest-view/actions';
import { GUEST_VIEW_COOKIE, verifyGuestViewToken } from '@/domain/identity/guest-view';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { startGuestView } from '../_lib/guest-view-actions';
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
  // The checkbox submits `merged=on`; `1` is kept for links written by hand.
  const showMerged = sp.merged === 'on' || sp.merged === '1';
  const [list, hh] = await Promise.all([
    adminInvoke<{ guests: Guest[]; truncated: boolean }>('admin_list_guests', { q: sp.q || undefined, householdId: sp.householdId || undefined, includeMerged: showMerged }, { method: 'GET' }),
    adminInvoke<{ households: { id: string; name: string }[]; truncated: boolean }>('admin_list_households', {}, { method: 'GET' }),
  ]);
  const rows = list.ok ? list.value.data.guests : [];
  const households = (hh.ok ? hh.value.data.households : []).map((h) => ({ value: h.id, label: h.name }));
  const truncated = (list.ok && list.value.data.truncated) || (hh.ok && hh.value.data.truncated);
  const isOwner = principal.roles.has('owner');
  const household = sp.householdId ? households.find((h) => h.value === sp.householdId) : undefined;
  const mergeTargets = rows.filter((g) => !g.mergedIntoGuestId).map((g) => ({ value: g.id, label: `${g.displayName} (${g.householdName})` }));
  // Browsing as anyone but yourself is for owners (`admin_browse_as_guest` re-checks it). It sets a
  // cookie and opens the site, so it stays a plain form action rather than a flow.
  const canBrowseAs = isOwner;
  const browsing = verifyGuestViewToken((await cookies()).get(GUEST_VIEW_COOKIE)?.value, principal.sessionId, getPreviewSecret(), new Date());
  const browsingName = browsing ? (rows.find((g) => g.id === browsing.guestId)?.displayName ?? 'a guest') : null;

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
      {browsing ? (
        <Note>
          You are browsing the site as <strong>{browsingName}</strong>. The console still shows you as yourself. <a href="/">Open the site</a>{' '}
          <form action={stopGuestView} className="flow-inline-form">
            <button type="submit" className="flow-trigger-quiet">
              Stop browsing as {browsingName}
            </button>
          </form>
        </Note>
      ) : null}

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
        <RecordList label="Guests" empty={rows.length === 0 ? 'No guest matches this search.' : null}>
          {rows.map((g) => (
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
                    <GuestFlow guest={g} households={households} label="Edit" variant="quiet" />
                    {g.claimed ? <RebindFlow guest={g} /> : null}
                    <MergeFlow guest={g} others={mergeTargets.filter((o) => o.value !== g.id)} />
                    {canBrowseAs ? (
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
      </Section>

      <Section title="Browse the site as a guest" id="browse-as">
        <p className="con-note">
          See the site the way one guest does: their account menu, their weekend, their RSVP and table, in this browser only. It is read-only: nothing you do there is saved or sent in their name, and their ride
          credit and the concierge stay closed. A band on every page says whose view it is, with the way to stop.
        </p>
        <p className="con-note">
          {canBrowseAs
            ? 'Choose “Browse as” beside a guest in the list above.'
            : 'Browsing as a guest is for the site’s owners: a view reads everything that guest can, which reaches past what this role’s screens show.'}
        </p>
      </Section>

      {isOwner ? (
        <Section title="Who can use this console" id="roles" note="Owners only. Changing someone’s access asks you to confirm it’s you first.">
          <AdminRoleFlow />
        </Section>
      ) : null}
    </ConsolePage>
  );
}
