import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterBar, RecordList, RecordRow } from '@/components/admin/flow/records';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Input } from '../_components/ops';
import { ConsoleGate, ConsolePage, Note, Pill, Section } from '../_components/console';
import { DeleteHouseholdFlow, HouseholdFlow } from './_components/HouseholdFlows';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Households', robots: { index: false, follow: false } };

type Household = { id: string; name: string; managerGuestId: string | null; memberCount: number; invitation: { status: string; tokenPrefix: string } | null };

const INVITATION: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  active: { label: 'Invitation sent', tone: 'good' },
  claimed: { label: 'Invitation opened', tone: 'good' },
  expired: { label: 'Invitation expired', tone: 'warn' },
  revoked: { label: 'Invitation revoked', tone: 'neutral' },
};

/** Households: the RSVP unit. Add, edit and delete are flows (`components/admin/flow/CONVENTIONS.md`). */
export default async function HouseholdsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if ((await adminPrincipal()).kind !== 'admin') return <ConsoleGate what="Households" />;
  const list = await adminInvoke<{ households: Household[]; truncated: boolean }>('admin_list_households', { q: sp.q || undefined }, { method: 'GET' });
  const rows = list.ok ? list.value.data.households : [];
  return (
    <ConsolePage
      title="Households"
      lede="The RSVP unit. One manager per household; children and guests without email are managed by them."
      notice={{ ok: sp.ok, error: sp.error ?? (!list.ok ? list.error.message : undefined) }}
      actions={<HouseholdFlow label="Add a household" />}
    >
      {list.ok && list.value.data.truncated ? <Note>There are more households than this screen lists at once. Only the first {rows.length} are shown; narrow the list with a search.</Note> : null}
      <Section title="All households" id="households">
        <FilterBar>
          <Input id="q" label="Search" defaultValue={sp.q} />
        </FilterBar>
        <RecordList label="Households" empty={rows.length === 0 ? 'No household matches this search.' : null}>
          {rows.map((h) => {
            const inv = h.invitation ? INVITATION[h.invitation.status] : undefined;
            return (
              <RecordRow
                key={h.id}
                data-household-id={h.id}
                title={h.name}
                status={inv ? <Pill tone={inv.tone}>{inv.label}</Pill> : <Pill>No invitation yet</Pill>}
                meta={
                  <>
                    {h.memberCount} {h.memberCount === 1 ? 'guest' : 'guests'}
                    {h.managerGuestId ? '' : ' · no manager chosen'}
                  </>
                }
                actions={
                  <>
                    <Link className="flow-trigger-quiet" href={`/admin/guests?householdId=${encodeURIComponent(h.id)}`} aria-label={`Guests in ${h.name}`}>
                      Guests
                    </Link>
                    <HouseholdFlow household={h} label="Edit" variant="quiet" />
                    {h.memberCount === 0 ? <DeleteHouseholdFlow household={h} /> : null}
                  </>
                }
              />
            );
          })}
        </RecordList>
      </Section>
    </ConsolePage>
  );
}
