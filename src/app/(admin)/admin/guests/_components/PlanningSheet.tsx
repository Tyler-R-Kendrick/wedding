import type { GuestSheetCopyView, GuestSheetView } from '@/capabilities/admin_guest_sheet';
import { DataTable, Note, Section, Stamp, Stat, StatStrip } from '../../_components/console';
import { UpdatePlanningSheetFlow } from './GuestFlows';

const dash = (v: string | number | null) => (v === null || v === '' || v === 0 ? '—' : v);

/**
 * The couple's planning sheet, as last copied into the site. It sits above the site's own guest
 * records because it is where the list is actually kept: the records below are who can sign in,
 * the sheet is who is invited. Edits happen in the sheet; "Update from the sheet" saves a new copy.
 */
export function PlanningSheet({ sheet, error }: { sheet: GuestSheetView | null; error: string | null }) {
  const copy = sheet?.copy ?? null;
  return (
    <Section title="Planning sheet" id="planning-sheet" note="The guest list as it stands in the planning spreadsheet. Edit it there, then update the copy here.">
      {!sheet ? (
        <Note>{error ?? 'The planning sheet could not be read.'}</Note>
      ) : (
        <>
          <div>
            <UpdatePlanningSheetFlow hasCopy={!!copy} />
          </div>
          {copy ? <SheetBody sheet={copy} /> : <Note>No copy of the planning sheet yet. Choose Add the planning sheet and paste its Guests tab.</Note>}
        </>
      )}
    </Section>
  );
}

function SheetBody({ sheet }: { sheet: GuestSheetCopyView }) {
  const { totals, rows } = sheet;
  return (
    <>
      <p className="con-note">
        Copied from the sheet <Stamp at={sheet.uploadedAt} />
        {sheet.source ? <> ({sheet.source})</> : null}.
      </p>
      {sheet.missingColumns.length ? <Note>Columns not found in the sheet: {sheet.missingColumns.join(', ')}. Those fields show as blank.</Note> : null}
      {sheet.withheldColumns.length ? <Note>Not copied from the sheet, on purpose: {sheet.withheldColumns.join(', ')}.</Note> : null}
      <StatStrip>
        <Stat label="Lines" value={totals.households} />
        <Stat label="Adults" value={totals.adults} />
        <Stat label="Kids" value={totals.kids} />
        <Stat label="Plus-ones" value={totals.plusOnes} />
        <Stat label="People" value={totals.people} hint="adults, kids and plus-ones" />
      </StatStrip>
      {totals.byPriority.length ? (
        <DataTable
          caption="Head count by priority"
          head={
            <tr>
              <th scope="col">Priority</th>
              <th scope="col">Lines</th>
              <th scope="col">People</th>
              <th scope="col">Through this priority</th>
            </tr>
          }
        >
          {totals.byPriority.map((p) => (
            <tr key={p.priority}>
              <th scope="row">{p.priority}</th>
              <td>{p.households}</td>
              <td>{p.people}</td>
              <td>{p.cumulativePeople}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      <DataTable
        caption="Every line of the sheet"
        empty={rows.length === 0 ? <>The sheet has no guest lines yet.</> : null}
        head={
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Adults</th>
            <th scope="col">Kids</th>
            <th scope="col">Plus-ones</th>
            <th scope="col">Guest of</th>
            <th scope="col">Group</th>
            <th scope="col">Priority</th>
            <th scope="col">Save the date</th>
            <th scope="col">Invite</th>
            <th scope="col">RSVP</th>
            <th scope="col">Table</th>
            <th scope="col">Menu</th>
          </tr>
        }
      >
        {rows.map((r) => (
          <tr key={r.sheetRow} data-sheet-row={r.sheetRow}>
            <th scope="row">{r.name}</th>
            <td>{dash(r.adults)}</td>
            <td>{dash(r.kids)}</td>
            <td>{dash(r.plusOnes)}</td>
            <td>{dash(r.guestOf)}</td>
            <td>{dash(r.group)}</td>
            <td>{dash(r.priority)}</td>
            <td>{dash(r.saveTheDateSent)}</td>
            <td>{dash(r.inviteSent)}</td>
            <td>{dash(r.rsvp)}</td>
            <td>{dash(r.table)}</td>
            <td>{dash(r.menu)}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
