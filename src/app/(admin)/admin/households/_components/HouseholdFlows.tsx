'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';

export interface HouseholdSummary {
  id: string;
  name: string;
  memberCount: number;
}

interface Values extends Record<string, unknown> {
  name: string;
  managerGuestId: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
  /** Adults in the household, fetched on open: the only people who can manage it. */
  members: { value: string; label: string }[];
}

const EMPTY: Values = { name: '', managerGuestId: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '', notes: '', members: [] };

interface Detail {
  household: { name: string; managerGuestId: string | null; mailingAddress: Partial<Record<'line1' | 'line2' | 'city' | 'region' | 'postalCode' | 'country', string>> | null; notes: string | null };
  members: { id: string; displayName: string; kind: string; isMinor: boolean }[];
}

/**
 * Add a household, or edit one: its name and manager, where to post the invitation, then notes and
 * the record read back. Editing fetches the household when the sheet opens (`load`); the list only
 * carries names and counts.
 */
export function HouseholdFlow({ household, label, variant = 'primary' }: { household?: HouseholdSummary; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const load = household
    ? async () => {
        const res = await callCapability<Detail>('admin_get_household', { input: { householdId: household.id } });
        if (!res.ok || !res.data) return res.error?.message ?? 'That household could not be read.';
        const { household: h, members } = res.data;
        const a = h.mailingAddress ?? {};
        return {
          name: h.name,
          managerGuestId: h.managerGuestId ?? '',
          line1: a.line1 ?? '',
          line2: a.line2 ?? '',
          city: a.city ?? '',
          region: a.region ?? '',
          postalCode: a.postalCode ?? '',
          country: a.country ?? '',
          notes: h.notes ?? '',
          members: members.filter((m) => m.kind !== 'child' && !m.isMinor).map((m) => ({ value: m.id, label: m.displayName })),
        };
      }
    : undefined;

  const address = (v: Values) => [v.line1, v.line2, [v.city, v.region, v.postalCode].filter(Boolean).join(' '), v.country].filter(Boolean).join('\n');

  const steps: FlowStep<Values>[] = [
    {
      title: 'Name and manager',
      fields: ['name', 'managerGuestId'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="name" label="Name as printed" hint="As it goes on the envelope: “The Lovelace family”." />
          {household ? (
            <SelectField
              ctx={ctx}
              name="managerGuestId"
              label="Household manager"
              options={ctx.values.members}
              placeholder={ctx.values.members.length ? 'No manager yet' : 'Add an adult to this household first'}
              hint="Answers the RSVP for everyone here who does not sign in."
            />
          ) : (
            <p className="flow-hint">Add the guests next, then come back to choose who manages the household.</p>
          )}
        </>
      ),
      ready: (v) => v.name.trim().length > 0,
      readyHint: { field: 'name', message: 'Give the household a name.' },
    },
    {
      title: 'Mailing address',
      lede: 'Where the invitation is posted. Leave it empty if you do not have it yet.',
      fields: ['line1', 'line2', 'city', 'region', 'postalCode', 'country'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="line1" label="Address line 1" optional autoComplete="off" />
          <TextField ctx={ctx} name="line2" label="Address line 2" optional />
          <TextField ctx={ctx} name="city" label="City" optional />
          <TextField ctx={ctx} name="region" label="State or region" optional />
          <TextField ctx={ctx} name="postalCode" label="Postal code" optional />
          <TextField ctx={ctx} name="country" label="Country" optional />
        </>
      ),
    },
    {
      title: 'Notes and save',
      fields: ['notes'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="notes" label="Admin notes" multiline optional hint="Never shown to guests." />
          <ReviewList
            items={[
              { label: 'Name', value: ctx.values.name },
              ...(household ? [{ label: 'Manager', value: ctx.values.members.find((m) => m.value === ctx.values.managerGuestId)?.label ?? '' }] : []),
              { label: 'Address', value: address(ctx.values) },
            ]}
          />
        </>
      ),
    },
  ];

  return (
    <AdminFlow<Values>
      id={`households:household:${household?.id ?? 'new'}`}
      title={household ? `Edit ${household.name}` : 'Add a household'}
      trigger={{ label, variant, accessibleName: household ? `Edit ${household.name}` : undefined }}
      initial={household ? { ...EMPTY, name: household.name } : EMPTY}
      load={load}
      steps={steps}
      submit={{
        label: household ? 'Save household' : 'Add household',
        capability: 'admin_upsert_household',
        success: household ? 'Household saved.' : 'Household added.',
        input: (v) => {
          const mailing = { line1: v.line1.trim(), line2: v.line2.trim(), city: v.city.trim(), region: v.region.trim(), postalCode: v.postalCode.trim(), country: v.country.trim() };
          return {
            id: household?.id,
            name: v.name.trim(),
            managerGuestId: v.managerGuestId || null,
            mailingAddress: Object.values(mailing).some(Boolean) ? mailing : null,
            notes: v.notes.trim() || null,
          };
        },
      }}
    />
  );
}

/** Only an empty household can be deleted; the row offers this only when it has no members. */
export function DeleteHouseholdFlow({ household }: { household: HouseholdSummary }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`households:delete:${household.id}`}
      tone="danger"
      title={`Delete ${household.name}`}
      trigger={{ label: 'Delete', variant: 'danger', accessibleName: `Delete ${household.name}` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Delete ${household.name}?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>The household has no guests. Deleting it also removes its address, notes and any invitation link issued to it. This cannot be undone.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, delete ${household.name}`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Delete ${household.name}`, capability: 'admin_delete_household', success: `${household.name} deleted.`, input: () => ({ householdId: household.id }) }}
    />
  );
}
