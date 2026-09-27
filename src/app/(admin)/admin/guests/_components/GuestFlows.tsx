'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';

export interface GuestSummary {
  id: string;
  householdId: string;
  householdName: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string | null;
  kind: string;
  isMinor: boolean;
  managedByGuestId: string | null;
  notes: string | null;
  claimed: boolean;
}

type Option = { value: string; label: string };

const KINDS = [
  { value: 'adult', label: 'Adult', description: 'Signs in with their own email.' },
  { value: 'child', label: 'Child', description: 'Answered for by the household manager.' },
  { value: 'plus_one', label: 'Plus-one', description: 'Someone a guest is bringing.' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;

interface GuestValues extends Record<string, unknown> {
  householdId: string;
  firstName: string;
  lastName: string;
  kind: string;
  isMinor: boolean;
  email: string;
  managedByGuestId: string;
  notes: string;
  /** The chosen household's members, fetched on step 1, for the "managed by" choice. */
  members: Option[];
}

/**
 * Add a guest, or edit one: who they are, how to reach them, then the record read back.
 *
 * "Managed by" was a text box for a guest id. It is now a choice among the household's own
 * members, fetched when the household is chosen, because that is the only valid answer.
 */
export function GuestFlow({ guest, households, defaultHouseholdId, label, variant = 'primary' }: { guest?: GuestSummary; households: Option[]; defaultHouseholdId?: string; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const initial: GuestValues = {
    householdId: guest?.householdId ?? defaultHouseholdId ?? '',
    firstName: guest?.firstName ?? '',
    lastName: guest?.lastName ?? '',
    kind: guest?.kind ?? 'adult',
    isMinor: guest?.isMinor ?? false,
    email: guest?.email ?? '',
    managedByGuestId: guest?.managedByGuestId ?? '',
    notes: guest?.notes ?? '',
    members: [],
  };
  const householdName = (id: string) => households.find((h) => h.value === id)?.label ?? '';

  const steps: FlowStep<GuestValues>[] = [
    {
      title: 'Who',
      lede: 'Their name as it is printed on the invitation.',
      fields: ['householdId', 'firstName', 'lastName', 'kind', 'isMinor'],
      render: (ctx) => (
        <>
          <SelectField ctx={ctx} name="householdId" label="Household" options={households} placeholder={households.length ? 'Choose a household' : 'Add a household first'} />
          <TextField ctx={ctx} name="firstName" label="First name" autoComplete="off" />
          <TextField ctx={ctx} name="lastName" label="Last name" optional />
          <ChoiceField ctx={ctx} name="kind" legend="Kind" choices={KINDS} />
          <CheckField ctx={ctx} name="isMinor" label="A minor" hint="A minor never signs in; the household manager answers for them." />
        </>
      ),
      ready: (v) => Boolean(v.householdId && v.firstName.trim()),
      readyHint: { field: 'firstName', message: 'Choose a household and enter a first name.' },
      next: async (v) => {
        const res = await callCapability<{ members: { id: string; displayName: string; kind: string; isMinor: boolean }[] }>('admin_get_household', { input: { householdId: v.householdId } });
        if (!res.ok || !res.data) return { errors: { householdId: res.error?.message ?? 'That household could not be read.' } };
        const members = res.data.members.filter((m) => m.id !== guest?.id && m.kind !== 'child' && !m.isMinor).map((m) => ({ value: m.id, label: m.displayName }));
        // A manager from another household is not a manager of this one.
        const keep = members.some((m) => m.value === v.managedByGuestId) ? v.managedByGuestId : '';
        return { patch: { members, managedByGuestId: keep } };
      },
    },
    {
      title: 'How to reach them',
      fields: ['email', 'managedByGuestId', 'notes'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="email" label="Email" type="email" inputMode="email" optional spellCheck={false} hint="Sign-in codes go here. Leave empty for someone the household manager answers for." />
          <SelectField
            ctx={ctx}
            name="managedByGuestId"
            label="Answered for by"
            options={ctx.values.members}
            placeholder="The household manager"
            hint="Who replies for this guest when they do not sign in themselves."
          />
          <TextField ctx={ctx} name="notes" label="Admin notes" multiline optional hint="Never shown to guests. Dietary and access needs belong in the RSVP, not here." />
        </>
      ),
    },
    {
      title: 'Check and save',
      render: (ctx) => {
        const v = ctx.values;
        return (
          <ReviewList
            items={[
              { label: 'Name', value: `${v.firstName} ${v.lastName}`.trim() },
              { label: 'Household', value: householdName(v.householdId) },
              { label: 'Kind', value: `${kindLabel(v.kind)}${v.isMinor ? ', a minor' : ''}` },
              { label: 'Email', value: v.email },
              { label: 'Answered for by', value: v.members.find((m) => m.value === v.managedByGuestId)?.label ?? (v.managedByGuestId ? '' : 'The household manager') },
              { label: 'Notes', value: v.notes },
            ]}
          />
        );
      },
    },
  ];

  return (
    <AdminFlow<GuestValues>
      id={`guests:guest:${guest?.id ?? 'new'}`}
      title={guest ? `Edit ${guest.displayName}` : 'Add a guest'}
      trigger={{ label, variant, accessibleName: guest ? `Edit ${guest.displayName}` : undefined }}
      initial={initial}
      steps={steps}
      submit={{
        label: guest ? 'Save guest' : 'Add a guest',
        capability: 'admin_upsert_guest',
        success: guest ? 'Guest saved.' : 'Guest added.',
        input: (v) => ({
          id: guest?.id,
          householdId: v.householdId,
          firstName: v.firstName.trim(),
          lastName: v.lastName.trim(),
          email: v.email.trim() || null,
          kind: v.kind,
          isMinor: v.isMinor,
          managedByGuestId: v.managedByGuestId || null,
          notes: v.notes.trim() || null,
        }),
      }}
    />
  );
}

interface ConfirmValues extends Record<string, unknown> {
  confirmed: boolean;
  reason: string;
  email: string;
  keepId: string;
}

const CONFIRM: ConfirmValues = { confirmed: false, reason: '', email: '', keepId: '' };

/** Removes a guest who has never signed in. Someone who has is reset instead, so nothing they did is lost silently. */
export function DeleteGuestFlow({ guest }: { guest: GuestSummary }) {
  return (
    <AdminFlow<ConfirmValues>
      id={`guests:delete:${guest.id}`}
      tone="danger"
      title={`Delete ${guest.displayName}`}
      trigger={{ label: 'Delete', variant: 'danger', accessibleName: `Delete ${guest.displayName}` }}
      initial={CONFIRM}
      steps={[
        {
          title: `Delete ${guest.displayName}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  {guest.displayName} is taken off the guest list of {guest.householdName}, with any RSVP answers and seat. This cannot be undone; adding them again starts from
                  nothing.
                </p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, delete ${guest.displayName}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Delete ${guest.displayName}`, capability: 'admin_delete_guest', success: `${guest.displayName} deleted.`, input: () => ({ guestId: guest.id }) }}
    />
  );
}

/** Signs a guest out everywhere and lets them claim their place again, from their invitation. */
export function ResetAccessFlow({ guest }: { guest: GuestSummary }) {
  return (
    <AdminFlow<ConfirmValues>
      id={`guests:reset:${guest.id}`}
      tone="danger"
      title={`Reset ${guest.displayName}’s access`}
      trigger={{ label: 'Reset access', variant: 'danger', accessibleName: `Reset ${guest.displayName}’s access` }}
      initial={CONFIRM}
      steps={[
        {
          title: `Reset ${guest.displayName}’s access?`,
          fields: ['reason', 'confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>{guest.displayName} is signed out on every device, and their sign-in is removed. They claim their place again from their invitation link.</p>
                <p>Their RSVP answers and seat stay as they are.</p>
              </Consequences>
              <TextField ctx={ctx} name="reason" label="Why" hint="Kept in the audit trail. For example: “lost their phone”." />
              <CheckField ctx={ctx} name="confirmed" label={`Yes, reset ${guest.displayName}’s access`} />
            </>
          ),
          ready: (v) => v.confirmed && v.reason.trim().length > 0,
          readyHint: { field: 'confirmed', message: 'Say why, and tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Reset ${guest.displayName}’s access`, capability: 'admin_reset_identity', success: `${guest.displayName} can claim their place again.`, input: (v) => ({ guestId: guest.id, reason: v.reason.trim() }) }}
    />
  );
}

/** Moves a signed-in guest's access to a new email; the old one stops working. */
export function RebindFlow({ guest }: { guest: GuestSummary }) {
  return (
    <AdminFlow<ConfirmValues>
      id={`guests:rebind:${guest.id}`}
      tone="danger"
      title={`Move ${guest.displayName}’s access`}
      trigger={{ label: 'Move access', variant: 'quiet', accessibleName: `Move ${guest.displayName}’s access to another email` }}
      initial={CONFIRM}
      steps={[
        {
          title: 'Move access to another email',
          fields: ['email', 'reason', 'confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  {guest.displayName} signs in with the new email from now on.
                  {guest.email ? ` ${guest.email} stops working at once.` : ' The email they used before stops working at once.'}
                </p>
              </Consequences>
              <TextField ctx={ctx} name="email" label="New email" type="email" inputMode="email" spellCheck={false} />
              <TextField ctx={ctx} name="reason" label="Why" hint="Kept in the audit trail." />
              <CheckField ctx={ctx} name="confirmed" label="Yes, move their access to the new email" />
            </>
          ),
          ready: (v) => v.confirmed && v.email.trim().length > 0 && v.reason.trim().length > 0,
          readyHint: { field: 'confirmed', message: 'Enter the new email and why, then tick the box.' },
        },
      ]}
      submit={{ label: `Move ${guest.displayName}’s access`, capability: 'admin_rebind_identity', success: 'Access moved to the new email.', input: (v) => ({ guestId: guest.id, email: v.email.trim(), reason: v.reason.trim() }) }}
    />
  );
}

/** Folds a duplicate into the guest to keep: choose which one, then confirm. */
export function MergeFlow({ guest, others }: { guest: GuestSummary; others: Option[] }) {
  return (
    <AdminFlow<ConfirmValues>
      id={`guests:merge:${guest.id}`}
      tone="danger"
      title={`Merge ${guest.displayName} into another guest`}
      trigger={{ label: 'Merge', variant: 'quiet', accessibleName: `Merge ${guest.displayName} into another guest` }}
      initial={CONFIRM}
      steps={[
        {
          title: 'Which guest do you keep?',
          lede: `${guest.displayName} is the duplicate. Their answers move to the guest you keep.`,
          fields: ['keepId'],
          render: (ctx) => <SelectField ctx={ctx} name="keepId" label="Guest to keep" options={others} placeholder="Choose a guest" />,
          ready: (v) => Boolean(v.keepId),
          readyHint: { field: 'keepId', message: 'Choose the guest to keep.' },
        },
        {
          title: 'Merge them?',
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  {guest.displayName} is merged into <strong>{others.find((o) => o.value === ctx.values.keepId)?.label}</strong>. The duplicate leaves every list; its seat
                  moves to the guest you keep if they have none. This cannot be undone here.
                </p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, merge the duplicate into the guest I keep" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: (v) => `Merge ${guest.displayName} into ${others.find((o) => o.value === v.keepId)?.label ?? 'the guest you keep'}`, capability: 'admin_merge_guests', success: 'Guests merged.', input: (v) => ({ keepId: v.keepId, mergeId: guest.id }) }}
    />
  );
}

interface ImportValues extends Record<string, unknown> {
  csv: string;
  summary: string;
  issues: string[];
}

interface ImportResult {
  dryRun: boolean;
  householdsCreated: number;
  guestsCreated: number;
  guestsUpdated: number;
  skipped: number;
  issues: { line: number; message: string }[];
}

const counts = (d: ImportResult) => `${d.householdsCreated} households and ${d.guestsCreated} guests to add, ${d.guestsUpdated} guests to update, ${d.skipped} lines skipped.`;

/**
 * Import a guest list: paste it, read what a dry run would do, then import. The dry run used to be
 * a checkbox you had to remember to tick; it is now the step every import passes through.
 */
export function ImportGuestsFlow() {
  return (
    <AdminFlow<ImportValues>
      id="guests:import"
      title="Import a guest list"
      trigger={{ label: 'Import a list', variant: 'ghost' }}
      initial={{ csv: '', summary: '', issues: [] }}
      steps={[
        {
          title: 'Paste the list',
          lede: 'From a spreadsheet saved as CSV, header row first.',
          fields: ['csv'],
          render: (ctx) => (
            <TextField
              ctx={ctx}
              name="csv"
              label="CSV"
              multiline
              rows={10}
              spellCheck={false}
              hint="Columns: household, first_name, last_name, email, kind, is_minor, manager, plus_one_of, event_keys, notes, address_line1…"
            />
          ),
          ready: (v) => v.csv.trim().length > 0,
          readyHint: { field: 'csv', message: 'Paste the list first.' },
          next: async (v) => {
            const res = await callCapability<ImportResult>('admin_import_guests_csv', { input: { csv: v.csv, dryRun: true } });
            if (!res.ok || !res.data) return { errors: { csv: res.error?.message ?? 'The list could not be read.' } };
            return { patch: { summary: counts(res.data), issues: res.data.issues.slice(0, 20).map((i) => `Line ${i.line}: ${i.message}`) } };
          },
        },
        {
          title: 'Check what will change',
          lede: 'Nothing has been saved yet. This is what importing would do.',
          render: (ctx) => (
            <>
              <p className="flow-copy">{ctx.values.summary}</p>
              {ctx.values.issues.length ? (
                <Consequences>
                  <p>These lines will be skipped:</p>
                  <ul>
                    {ctx.values.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </Consequences>
              ) : null}
            </>
          ),
        },
      ]}
      submit={{
        label: 'Import the list',
        capability: 'admin_import_guests_csv',
        success: 'List imported.',
        input: (v) => ({ csv: v.csv, dryRun: false }),
        result: (data) => {
          const d = data as ImportResult;
          return (
            <p>
              {d.householdsCreated} households and {d.guestsCreated} guests added, {d.guestsUpdated} guests updated, {d.skipped} lines skipped.
            </p>
          );
        },
      }}
    />
  );
}

interface RoleValues extends Record<string, unknown> {
  email: string;
  role: string;
}

const ROLES = [
  { value: 'owner', label: 'Owner', description: 'Everything, including who else can use the console.' },
  { value: 'planner', label: 'Planner', description: 'Guests, RSVPs, events, seating and content.' },
  { value: 'moderator', label: 'Moderator', description: 'The photo and video queue only.' },
  { value: 'none', label: 'No access', description: 'Removes their console access.' },
];

/** Owners only: who can use the console, and for what. */
export function AdminRoleFlow() {
  return (
    <AdminFlow<RoleValues>
      id="guests:admin-role"
      title="Change someone’s console access"
      trigger={{ label: 'Change someone’s access', variant: 'ghost' }}
      initial={{ email: '', role: 'planner' }}
      steps={[
        {
          title: 'Who',
          fields: ['email'],
          render: (ctx) => <TextField ctx={ctx} name="email" label="Their email" type="email" inputMode="email" spellCheck={false} hint="The address they sign in to the console with." />,
          ready: (v) => v.email.trim().length > 2,
          readyHint: { field: 'email', message: 'Enter their email.' },
        },
        {
          title: 'What they can do',
          fields: ['role'],
          render: (ctx) => <ChoiceField ctx={ctx} name="role" legend="Access" choices={ROLES} />,
        },
      ]}
      submit={{
        label: 'Save access',
        capability: 'admin_set_admin_role',
        success: 'Console access updated.',
        input: (v) => ({ email: v.email.trim(), role: v.role === 'none' ? null : v.role }),
      }}
    />
  );
}
