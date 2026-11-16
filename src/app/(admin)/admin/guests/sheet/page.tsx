import type { Metadata } from 'next';
import Link from 'next/link';
import { adminGuestSheet, adminGuestSheetSync } from '@/capabilities/admin_guest_sheet';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { adminInvoke, adminPrincipal } from '../../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, Day, Empty, Pill, Section, Stat, StatStrip } from '../../_components/console';
import { UpdatePlanningSheetFlow } from '../_components/GuestFlows';
import { PlanningSheet } from '../_components/PlanningSheet';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Guest sheet', robots: { index: false, follow: false } };

type Counts = { adults: number; kids: number; plusOnes: number };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "2 adults, 1 child, 1 plus-one", leaving out what there is none of; "nobody yet" for an empty household. */
function heads(c: Counts): string {
  const parts = [c.adults ? plural(c.adults, 'adult', 'adults') : '', c.kids ? plural(c.kids, 'child', 'children') : '', c.plusOnes ? plural(c.plusOnes, 'plus-one', 'plus-ones') : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nobody yet';
}
/** "9:19 PM CST": the day is the figure above it. */
const timeOfDay = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: WEDDING_TIMEZONE, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
const household = (id: string) => `/admin/guests?householdId=${encodeURIComponent(id)}#guests`;

/**
 * The planning sheet beside the site's guest list. The sheet is where the list is kept; the site is
 * who can sign in and reply. Syncing saves a fresh copy of the sheet, and this screen is what is
 * left to do afterwards: lines that are not households here yet, households whose head counts
 * disagree with their line, and households the sheet does not mention.
 *
 * Saving a copy adds everyone a line names (src/domain/guests/sheet-sync.ts) and removes nobody, so
 * what is listed here is what that sync left for a person: a line it could not read, a head count
 * that disagrees, a household the sheet no longer mentions.
 */
export default async function AdminGuestSheetPage() {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The guest sheet" />;

  const [sync, sheet] = await Promise.all([adminInvoke(adminGuestSheetSync, {}), adminInvoke(adminGuestSheet, {})]);
  if (!sync.ok) {
    return (
      <ConsolePage title="Guest sheet">
        <Denied message={sync.error.message} entitlement="admin_guest_ops" />
      </ConsolePage>
    );
  }
  const s = sync.value.data;
  const differing = s.matched.filter((m) => m.differs);
  const todo = s.onlyOnSheet.length + differing.length + s.onlyOnSite.length;
  const changes = s.changes && s.changes.added.length + s.changes.removed.length + s.changes.changed.length > 0 ? s.changes : null;

  return (
    <ConsolePage
      title="Guest sheet"
      lede="The guest list is kept in the planning spreadsheet. Syncing saves a copy of its Guests tab and adds everyone a line names to the guest list; nobody is removed. This screen lists what still differs. Addresses, phones, dietary needs and notes are never saved."
      actions={<UpdatePlanningSheetFlow hasCopy={!!s.copy} variant="primary" />}
    >
      {!s.copy || !s.summary ? (
        <Empty>No copy of the sheet yet. Choose Add the planning sheet, then paste the Guests tab or pick the file you downloaded from it.</Empty>
      ) : (
        <>
          <StatStrip>
            <Stat label="To reconcile" value={todo} hint={todo ? undefined : 'The site matches the sheet'} />
            <Stat label="Last synced" value={<Day at={s.copy.uploadedAt} />} hint={timeOfDay(s.copy.uploadedAt)} />
            <Stat label="Sheet lines" value={s.summary.lines} hint={`${s.summary.matched} matched`} />
            <Stat label="On the sheet" value={s.summary.sheetPeople} hint="people" />
            <Stat label="On the site" value={s.summary.sitePeople} hint="people" />
          </StatStrip>

          {changes ? (
            <Section title="Changed in this copy" id="changes" note="Against the copy saved before it.">
              <ul className="con-changes">
                {changes.added.map((c) => (
                  <li key={`a-${c.label}`}>
                    <Pill tone="good">New</Pill> {c.label}, {plural(c.people, 'person', 'people')}
                  </li>
                ))}
                {changes.changed.map((c) => (
                  <li key={`c-${c.label}`}>
                    <Pill tone="warn">Changed</Pill> {c.label}: {heads(c.before)} is now {heads(c.after)}
                  </li>
                ))}
                {changes.removed.map((c) => (
                  <li key={`r-${c.label}`}>
                    <Pill>Removed</Pill> {c.label}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={`On the sheet, not on the site (${s.onlyOnSheet.length})`} id="missing" note="Lines the last sync left alone: nobody on the line could be read as a name, or two guests already answer to one. Link the line to its household, or add an empty household and its people on Guests.">
            <RecordList label="Sheet lines that are not households here" empty={s.onlyOnSheet.length === 0 ? 'Every line of the sheet is a household here.' : null}>
              {s.onlyOnSheet.map((line) => (
                <RecordRow
                  key={line.sheetRow}
                  title={line.label}
                  meta={
                    <>
                      {heads(line.sheet)} · row {line.sheetRow}
                      {line.suggestion ? <> · looks like {line.suggestion.name}</> : null}
                    </>
                  }
                  actions={
                    <>
                      {line.suggestion ? (
                        <QuickAction label={`It is ${line.suggestion.name}`} busyLabel="Linking" done="Linked." accessibleName={`Link ${line.label} to ${line.suggestion.name}`} calls={[{ capability: 'admin_link_sheet_line', input: { householdId: line.suggestion.id, label: line.label } }]} />
                      ) : null}
                      <QuickAction label={line.suggestion ? 'Add as new' : 'Add household'} busyLabel="Adding" done="Added." accessibleName={`Add ${line.label} as a household`} calls={[{ capability: 'admin_add_household_from_sheet', input: { label: line.label } }]} />
                    </>
                  }
                />
              ))}
            </RecordList>
          </Section>

          <Section title={`Head counts differ (${differing.length})`} id="differing" note="Grown-ups are compared together, and children. A head the sheet counts and does not name is kept here as a plus-one.">
            <RecordList label="Households whose head counts differ from their sheet line" empty={differing.length === 0 ? 'Every matched household has the heads its line counts.' : null}>
              {differing.map((m) => (
                <RecordRow
                  key={m.sheetRow}
                  title={m.household.name}
                  status={m.household.name === m.label ? null : <Pill>{m.label} on the sheet</Pill>}
                  meta={
                    <>
                      Sheet: {heads(m.sheet)}. Site: {heads(m.site)}.
                    </>
                  }
                  actions={
                    <Link className="flow-trigger-quiet" href={household(m.household.id)}>
                      Open the household
                    </Link>
                  }
                />
              ))}
            </RecordList>
          </Section>

          <Section title={`On the site, not on the sheet (${s.onlyOnSite.length})`} id="extra" note="A household here that no line of the sheet answers to: added by hand, renamed on one side, or taken off the sheet.">
            <RecordList label="Households that are not on the sheet" empty={s.onlyOnSite.length === 0 ? 'Every household here is on the sheet.' : null}>
              {s.onlyOnSite.map((h) => (
                <RecordRow
                  key={h.id}
                  title={h.name}
                  meta={heads(h.site)}
                  actions={
                    <Link className="flow-trigger-quiet" href={household(h.id)}>
                      Open the household
                    </Link>
                  }
                />
              ))}
            </RecordList>
          </Section>

          <details className="flow-details">
            <summary>Matched lines ({s.matched.length})</summary>
            <DataTable
              caption="Sheet lines and the household each one is"
              head={
                <tr>
                  <th scope="col">Sheet line</th>
                  <th scope="col">Household here</th>
                  <th scope="col">Matched by</th>
                  <th scope="col">On the sheet</th>
                  <th scope="col">On the site</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              }
              empty={s.matched.length === 0 ? <>No line of the sheet is a household here yet.</> : null}
            >
              {s.matched.map((m) => (
                <tr key={m.sheetRow}>
                  <th scope="row">{m.label}</th>
                  <td>
                    <Link href={household(m.household.id)}>{m.household.name}</Link>
                  </td>
                  <td>{m.how === 'linked' ? 'A saved link' : 'The same name'}</td>
                  <td>{heads(m.sheet)}</td>
                  <td>{heads(m.site)}</td>
                  <td>{m.how === 'linked' ? <QuickAction label="Unlink" busyLabel="Unlinking" done="Unlinked." accessibleName={`Unlink ${m.label} from ${m.household.name}`} calls={[{ capability: 'admin_link_sheet_line', input: { householdId: m.household.id, label: null } }]} /> : null}</td>
                </tr>
              ))}
            </DataTable>
          </details>

          <details className="flow-details">
            <summary>The sheet as copied</summary>
            <PlanningSheet sheet={sheet.ok ? sheet.value.data : null} error={sheet.ok ? null : sheet.error.message} hideUpdate />
          </details>
        </>
      )}
    </ConsolePage>
  );
}
