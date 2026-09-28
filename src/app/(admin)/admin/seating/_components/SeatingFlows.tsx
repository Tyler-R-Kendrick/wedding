'use client';

import { useList } from '@/components/admin/flow/lists';
import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';

type Option = { value: string; label: string };

export interface TableSummary {
  id: string;
  name: string;
  capacity: number;
  floorPlanId: string | null;
  anchorId: string | null;
  notes: string | null;
  seated: number;
}

export interface PlanSummary {
  id: string;
  name: string;
  anchors: { id: string; label: string }[];
}

/* --------------------------------------------------------------- tables ------------------- */

interface TableValues extends Record<string, unknown> {
  name: string;
  capacity: string;
  floorPlanId: string;
  anchorId: string;
  notes: string;
}

const tableValues = (t?: TableSummary): TableValues => ({ name: t?.name ?? '', capacity: String(t?.capacity ?? 10), floorPlanId: t?.floorPlanId ?? '', anchorId: t?.anchorId ?? '', notes: t?.notes ?? '' });
const validCapacity = (s: string) => /^\d{1,2}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 30;

/**
 * Add a table, or edit one: its name and size, where it stands on the floor plan, then notes and
 * the table read back. "Anchor on the plan" was a text box with a list of anchor ids in its hint;
 * it is now a choice among the chosen plan's own spots, by name.
 */
export function TableFlow({ table, plans, nextOrder, label, variant = 'primary' }: { table?: TableSummary; plans: PlanSummary[]; nextOrder: number; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const anchorsOf = (planId: string) => plans.find((p) => p.id === planId)?.anchors ?? [];
  const steps: FlowStep<TableValues>[] = [
    {
      title: 'Name and size',
      fields: ['name', 'capacity'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="name" label="Name" hint="As guests will read it: “Table 4”, “The Garden table”." />
          <TextField ctx={ctx} name="capacity" label="Seats" type="number" min={1} max={30} inputMode="numeric" />
          {table && table.seated > 0 ? <p className="flow-hint">{table.seated} guests are seated here now; the table cannot seat fewer.</p> : null}
        </>
      ),
      ready: (v) => v.name.trim().length > 0 && validCapacity(v.capacity),
      readyHint: { field: 'capacity', message: 'Give the table a name and a number of seats from 1 to 30.' },
    },
    {
      title: 'Where it is',
      lede: 'Guests see their table highlighted on this plan. Leave it empty until the layout is settled.',
      fields: ['floorPlanId', 'anchorId'],
      render: (ctx) => {
        const anchors = anchorsOf(ctx.values.floorPlanId).map((a) => ({ value: a.id, label: a.label }));
        return (
          <>
            <SelectField ctx={ctx} name="floorPlanId" label="Floor plan" optional options={plans.map((p) => ({ value: p.id, label: p.name }))} placeholder="None yet" />
            {ctx.values.floorPlanId ? <SelectField ctx={ctx} name="anchorId" label="Spot on the plan" optional options={anchors} placeholder="Not placed yet" /> : null}
          </>
        );
      },
      // A spot from another plan is no spot on this one.
      next: async (v) => (v.anchorId && !anchorsOf(v.floorPlanId).some((a) => a.id === v.anchorId) ? { patch: { anchorId: '' } } : undefined),
    },
    {
      title: 'Notes and save',
      fields: ['notes'],
      render: (ctx) => {
        const v = ctx.values;
        const plan = plans.find((p) => p.id === v.floorPlanId);
        return (
          <>
            <TextField ctx={ctx} name="notes" label="Planning notes" multiline optional hint="Never shown to guests." />
            <ReviewList
              items={[
                { label: 'Name', value: v.name.trim() },
                { label: 'Seats', value: v.capacity },
                { label: 'Floor plan', value: plan ? [plan.name, plan.anchors.find((a) => a.id === v.anchorId)?.label].filter(Boolean).join(', ') : '' },
              ]}
            />
          </>
        );
      },
    },
  ];
  return (
    <AdminFlow<TableValues>
      id={`seating:table:${table?.id ?? 'new'}`}
      title={table ? `Edit ${table.name}` : 'Add a table'}
      trigger={{ label, variant, accessibleName: table ? `Edit ${table.name}` : undefined }}
      initial={tableValues(table)}
      load={table ? async () => tableValues(table) : undefined}
      steps={steps}
      submit={{
        label: table ? 'Save table' : 'Add a table',
        capability: 'admin_upsert_table',
        success: table ? `${table.name} saved (draft).` : 'Table added (draft).',
        input: (v) => ({
          id: table?.id,
          name: v.name.trim(),
          capacity: Number(v.capacity),
          floorPlanId: v.floorPlanId || null,
          anchorId: (v.floorPlanId && v.anchorId) || null,
          notes: v.notes.trim() || null,
          // A new table goes to the end of the list; an edit keeps its place.
          ...(table ? {} : { sortOrder: nextOrder }),
        }),
      }}
    />
  );
}

export function DeleteTableFlow({ table }: { table: TableSummary }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`seating:delete:${table.id}`}
      tone="danger"
      title={`Delete ${table.name}`}
      trigger={{ label: 'Delete', variant: 'danger', accessibleName: `Delete ${table.name}` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Delete ${table.name}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  {table.name} is removed from the draft
                  {table.seated ? `, and the ${table.seated} ${table.seated === 1 ? 'guest' : 'guests'} seated at it lose their seats` : ''}. Guests see no change until the
                  seating is published again. This cannot be undone.
                </p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={table.seated ? `Yes, delete ${table.name} and unseat its guests` : `Yes, delete ${table.name}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Delete ${table.name}`, capability: 'admin_delete_table', success: `${table.name} deleted (draft).`, input: () => ({ id: table.id }) }}
    />
  );
}

/* ----------------------------------------------------------------- seats ------------------ */

interface SeatValues extends Record<string, unknown> {
  tableId: string;
  seatNumber: string;
}

const validSeat = (s: string) => !s.trim() || (/^\d{1,2}$/.test(s.trim()) && Number(s) >= 1 && Number(s) <= 99);

/** Seat one guest at a draft table, or move them. One question, so one step. */
export function SeatFlow({ guest, tables: given }: { guest: { guestId: string; displayName: string; tableId: string; seatNumber: number | null }; tables?: Option[] }) {
  // The page's one list of tables (`ListsProvider`), not a copy per guest.
  const tables = useList('tables', given);
  const from = (): SeatValues => ({ tableId: guest.tableId, seatNumber: guest.seatNumber ? String(guest.seatNumber) : '' });
  const verb = guest.tableId ? 'Move' : 'Seat';
  return (
    <AdminFlow<SeatValues>
      id={`seating:seat:${guest.guestId}`}
      title={`${verb} ${guest.displayName}`}
      trigger={{ label: verb, variant: 'quiet', accessibleName: `${verb} ${guest.displayName}` }}
      initial={from()}
      load={async () => from()}
      steps={[
        {
          title: `Where does ${guest.displayName} sit?`,
          fields: ['tableId', 'seatNumber'],
          render: (ctx) => (
            <>
              <SelectField ctx={ctx} name="tableId" label="Table" options={tables} placeholder={tables.length ? 'Choose a table' : 'Add a table first'} hint="Seats taken of seats at each table, in brackets." />
              <TextField ctx={ctx} name="seatNumber" label="Seat number" type="number" min={1} max={99} optional hint="Leave it empty when guests choose their own seat at the table." />
            </>
          ),
          ready: (v) => Boolean(v.tableId) && validSeat(v.seatNumber),
          readyHint: { field: 'tableId', message: 'Choose a table, and a seat number from 1 to 99 or none.' },
        },
      ]}
      submit={{
        label: 'Save seat',
        capability: 'admin_assign_seats',
        success: `${guest.displayName} seated (draft).`,
        input: (v) => ({ changes: [{ guestId: guest.guestId, tableId: v.tableId, seatNumber: v.seatNumber.trim() ? Number(v.seatNumber) : null }] }),
      }}
    />
  );
}

/* ---------------------------------------------------------------- import ------------------ */

interface ImportValues extends Record<string, unknown> {
  csv: string;
  defaultCapacity: string;
  replace: boolean;
}

interface ImportResult {
  applied: number;
  createdTables: string[];
  errors: { line: number; message: string }[];
  unresolved: { line: number; guest: string }[];
}

/**
 * The planner's chart has no dry run: the capability applies nothing when any line fails and says
 * which. A refusal comes back as `ok` with the problems listed, so it is turned into an error on
 * the CSV field here, and the sheet goes back to the paste step with the lines named.
 */
async function importChart(input: unknown): Promise<CapabilityResponse> {
  const res = await callCapability<ImportResult>('admin_import_seating_csv', { input, idempotencyKey: newIdempotencyKey() });
  if (!res.ok || !res.data) return res;
  const d = res.data;
  const problems = [...d.errors.map((e) => `line ${e.line}: ${e.message}`), ...d.unresolved.map((u) => `line ${u.line}: no guest called “${u.guest}”`)];
  if (!problems.length) return res;
  const shown = problems.slice(0, 8).join('; ') + (problems.length > 8 ? `; and ${problems.length - 8} more` : '');
  return { ok: false, error: { code: 'validation', message: 'Nothing was imported.', details: { issues: [{ path: 'csv', message: `Nothing was imported. Fix these lines and try again: ${shown}.` }] } } };
}

export function ImportChartFlow() {
  return (
    <AdminFlow<ImportValues>
      id="seating:import"
      title="Import the planner’s chart"
      trigger={{ label: 'Import the planner’s chart', variant: 'ghost' }}
      initial={{ csv: '', defaultCapacity: '10', replace: false }}
      steps={[
        {
          title: 'Paste the chart',
          lede: 'From a spreadsheet saved as CSV: table, seat, guest on each line.',
          fields: ['csv'],
          render: (ctx) => (
            <TextField
              ctx={ctx}
              name="csv"
              label="CSV"
              multiline
              rows={10}
              spellCheck={false}
              hint="Guest is the name exactly as invited, or the guest id. Seat may be empty. Tables that do not exist yet are created."
            />
          ),
          ready: (v) => v.csv.trim().length > 0,
          readyHint: { field: 'csv', message: 'Paste the chart first.' },
        },
        {
          title: 'How to apply it',
          fields: ['defaultCapacity', 'replace'],
          render: (ctx) => (
            <>
              <TextField ctx={ctx} name="defaultCapacity" label="Seats at each new table" type="number" min={1} max={30} hint="Only for tables the chart names that do not exist yet." />
              <CheckField ctx={ctx} name="replace" label="Clear every current seat first" hint="Leave it unticked to add the chart to the seats already in the draft." />
            </>
          ),
          ready: (v) => validCapacity(v.defaultCapacity),
          readyHint: { field: 'defaultCapacity', message: 'Enter a number of seats from 1 to 30.' },
        },
        {
          title: 'Check and import',
          lede: 'Into the draft only: guests see nothing until the seating is published.',
          render: (ctx) => {
            const lines = ctx.values.csv.split('\n').filter((l) => l.trim()).length;
            return (
              <>
                <ReviewList
                  items={[
                    { label: 'Lines in the chart', value: String(lines) },
                    { label: 'Seats at each new table', value: ctx.values.defaultCapacity },
                    { label: 'Current seats', value: ctx.values.replace ? 'Cleared first' : 'Kept' },
                  ]}
                />
                {ctx.values.replace ? (
                  <Consequences>
                    <p>Every guest seated in the draft now loses their seat before the chart is applied.</p>
                  </Consequences>
                ) : null}
                <p className="flow-hint">If any line cannot be read or names someone who is not on the list, nothing is imported and those lines are shown.</p>
              </>
            );
          },
        },
      ]}
      submit={{
        label: 'Import into the draft',
        run: (v) => importChart({ csv: v.csv, replace: v.replace, defaultCapacity: Number(v.defaultCapacity) }),
        success: 'Chart imported into the draft.',
        result: (data) => {
          const d = data as ImportResult;
          return (
            <p>
              {d.applied} {d.applied === 1 ? 'guest' : 'guests'} seated
              {d.createdTables.length ? `; new tables: ${d.createdTables.join(', ')}` : ''}. Publish the seating when it is ready for guests.
            </p>
          );
        },
      }}
    />
  );
}

/* --------------------------------------------------------------- publish ------------------ */

export interface DraftSummary {
  tables: number;
  seated: number;
  /** Guests attending the reception with no seat in the draft. */
  attendingUnseated: string[];
  /** Tables with nobody at them. */
  emptyTables: string[];
  published: boolean;
  draftDiffers: boolean;
}

/**
 * Publish the draft: read what guests will get, then publish. Publishing needs a fresh sign-in
 * (step-up); the flow keeps the note across it.
 */
export function PublishFlow({ draft }: { draft: DraftSummary }) {
  const label = draft.published ? 'Publish the current draft' : 'Publish seating to guests';
  const list = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '));
  return (
    <AdminFlow<{ note: string }>
      id="seating:publish"
      title={label}
      trigger={{ label, variant: 'ghost' }}
      initial={{ note: '' }}
      steps={[
        {
          title: 'Check the draft',
          lede: 'This is what guests will get.',
          render: () => (
            <>
              <ReviewList
                items={[
                  { label: 'Tables', value: String(draft.tables) },
                  { label: 'Guests with a seat', value: String(draft.seated) },
                  { label: 'Coming, but no seat', value: draft.attendingUnseated.length ? list(draft.attendingUnseated) : 'Nobody' },
                  { label: 'Empty tables', value: draft.emptyTables.length ? list(draft.emptyTables) : 'None' },
                ]}
              />
              {draft.published && !draft.draftDiffers ? <p className="flow-copy">The draft is the same as the seating guests already see.</p> : null}
            </>
          ),
        },
        {
          title: 'Publish',
          fields: ['note'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>Every guest with a seat sees their table, their tablemates and the floor plan on Your Weekend straight away.</p>
                {draft.published ? <p>This replaces the seating guests see now. You can unpublish it again later.</p> : <p>You can unpublish it again later.</p>}
              </Consequences>
              <TextField ctx={ctx} name="note" label="Note to yourselves" optional hint="Kept with this publication in the history. Never shown to guests." />
            </>
          ),
        },
      ]}
      submit={{
        label: 'Publish to guests',
        capability: 'admin_publish_seating',
        success: 'Seating published. Guests can now see their table.',
        input: (v) => ({ note: v.note.trim() || null }),
      }}
    />
  );
}

export function UnpublishFlow() {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id="seating:unpublish"
      tone="danger"
      title="Unpublish the seating"
      trigger={{ label: 'Unpublish', variant: 'danger', accessibleName: 'Unpublish the seating' }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: 'Hide the seating from guests?',
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>Every table disappears from Your Weekend at once; guests are told the seating is not ready yet. The draft is untouched, and publishing again brings it back.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, hide the seating from guests" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: 'Unpublish the seating', capability: 'admin_unpublish_seating', success: 'Seating hidden from guests.', input: () => ({}) }}
    />
  );
}
