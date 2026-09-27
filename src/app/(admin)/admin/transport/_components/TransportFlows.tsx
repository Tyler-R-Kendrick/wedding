'use client';

import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';

export interface GuestOption {
  value: string;
  label: string;
  householdId: string;
  /** A minor or a child: the benefit is recorded, but they are never eligible to claim it. */
  minor: boolean;
}

/** An assigned benefit as the row shows it. Everything in it is admin-entered text; never a code or link. */
export interface RideSummary {
  id: string;
  guestId: string;
  guestName: string;
  householdId: string;
  program: string;
  amountNote: string | null;
  validityNote: string | null;
  geofenceNote: string | null;
  providerProgramRef: string | null;
  /** Not asked about in the flow; sent back as they are so a change of words does not clear them. */
  validFrom: string | null;
  validUntil: string | null;
  verifiedAt: string | null;
}

interface AssignValues extends Record<string, unknown> {
  guestId: string;
  program: string;
  amountNote: string;
  validityNote: string;
  geofenceNote: string;
  providerProgramRef: string;
}

const PROGRAMME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Give a guest a ride benefit, or change the words on one: who, then what they get as the guest will
 * read it, then the record read back.
 *
 * The form this replaces asked for a "Guest id" and a "Household id" to be typed in (the capability
 * then checked the second matched the first). The guest is now chosen by name, and the household is
 * the one they are in.
 */
export function AssignRideFlow({ guests, ride, defaultProgram, label, variant = 'primary', accessibleName }: { guests: GuestOption[]; ride?: RideSummary; defaultProgram: string; label: string; variant?: 'primary' | 'ghost' | 'quiet'; accessibleName?: string }) {
  const initial: AssignValues = {
    guestId: ride?.guestId ?? '',
    program: ride?.program ?? defaultProgram,
    amountNote: ride?.amountNote ?? '',
    validityNote: ride?.validityNote ?? '',
    geofenceNote: ride?.geofenceNote ?? '',
    providerProgramRef: ride?.providerProgramRef ?? '',
  };
  const guest = (id: string) => guests.find((g) => g.value === id);

  const steps: FlowStep<AssignValues>[] = [
    ...(ride
      ? []
      : [
          {
            title: 'Who',
            fields: ['guestId'],
            render: (ctx) => (
              <>
                <SelectField ctx={ctx} name="guestId" label="Guest" options={guests} placeholder={guests.length ? 'Choose a guest' : 'Add guests first'} hint="Their household is filled in from the guest list." />
                {guest(ctx.values.guestId)?.minor ? <p className="flow-hint">{guest(ctx.values.guestId)?.label} is a minor. The benefit is recorded, but they will not be able to claim a ride.</p> : null}
              </>
            ),
            ready: (v) => Boolean(v.guestId),
            readyHint: { field: 'guestId', message: 'Choose the guest.' },
          } satisfies FlowStep<AssignValues>,
        ]),
    {
      title: 'What they get',
      lede: 'In the words your planner confirmed. Guests read these exactly as you write them.',
      fields: ['amountNote', 'validityNote', 'geofenceNote', 'program', 'providerProgramRef'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="amountNote" label="Amount" optional hint="For example: “Up to $40 for one ride”." />
          <TextField ctx={ctx} name="validityNote" label="When it can be used" optional hint="For example: “The night of the wedding, 9 pm to 2 am”." />
          <TextField ctx={ctx} name="geofenceNote" label="Where it can be used" optional hint="For example: “From the venue to anywhere in Chicago”." />
          {ride ? null : (
            <TextField ctx={ctx} name="program" label="Programme" spellCheck={false} hint={`Which pool of rides this comes from. Lowercase letters, numbers and dashes; “${defaultProgram}” unless you run more than one.`} />
          )}
          <TextField ctx={ctx} name="providerProgramRef" label="Uber voucher programme reference" optional spellCheck={false} hint="From Uber, if you have one. Never a code or a link." />
        </>
      ),
      ready: (v) => PROGRAMME.test(v.program.trim()),
      readyHint: { field: 'program', message: 'Use lowercase letters, numbers and dashes for the programme.' },
    },
    {
      title: 'Check and save',
      render: (ctx) => {
        const v = ctx.values;
        return (
          <ReviewList
            items={[
              { label: 'Guest', value: ride?.guestName ?? guest(v.guestId)?.label ?? '' },
              { label: 'Amount', value: v.amountNote },
              { label: 'When', value: v.validityNote },
              { label: 'Where', value: v.geofenceNote },
              { label: 'Programme', value: v.program },
              { label: 'Uber reference', value: v.providerProgramRef },
            ]}
          />
        );
      },
    },
  ];

  return (
    <AdminFlow<AssignValues>
      id={`transport:assign:${ride?.id ?? 'new'}`}
      title={ride ? `Edit ${ride.guestName}’s ride benefit` : 'Give a guest a ride home'}
      trigger={{ label, variant, accessibleName }}
      initial={initial}
      steps={steps}
      submit={{
        label: ride ? 'Save ride benefit' : 'Give the ride benefit',
        capability: 'admin_assign_transportation_entitlement',
        success: ride ? 'Ride benefit saved.' : 'Ride benefit given.',
        input: (v) => ({
          guestId: v.guestId,
          householdId: guest(v.guestId)?.householdId ?? ride?.householdId ?? '',
          program: v.program.trim(),
          amountNote: v.amountNote.trim() || undefined,
          validityNote: v.validityNote.trim() || undefined,
          geofenceNote: v.geofenceNote.trim() || undefined,
          providerProgramRef: v.providerProgramRef.trim() || undefined,
          validFrom: ride?.validFrom ?? undefined,
          validUntil: ride?.validUntil ?? undefined,
          verifiedAt: ride?.verifiedAt ?? undefined,
        }),
      }}
    />
  );
}

/** Withdraws a benefit. Reactivating it is one click on the row, so this says so. */
export function RevokeRideFlow({ ride }: { ride: RideSummary }) {
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`transport:revoke:${ride.id}`}
      tone="danger"
      title={`Withdraw ${ride.guestName}’s ride benefit`}
      trigger={{ label: 'Withdraw', variant: 'danger', accessibleName: `Withdraw ${ride.guestName}’s ride benefit` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Withdraw ${ride.guestName}’s ride benefit?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>{ride.guestName} can no longer claim a ride from this benefit.</p>
                <p>A ride credit they have already claimed is not taken back from Uber; if they ask about it, they are told to contact you. You can reactivate the benefit later from this list.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label={`Yes, withdraw ${ride.guestName}’s ride benefit`} />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Withdraw ${ride.guestName}’s ride benefit`, capability: 'admin_revoke_transportation_entitlement', success: `${ride.guestName}’s ride benefit withdrawn.`, input: () => ({ entitlementId: ride.id, status: 'revoked' }) }}
    />
  );
}

interface UploadValues extends Record<string, unknown> {
  program: string;
  codes: string;
}

interface UploadResult {
  program: string;
  added: number;
  duplicates: number;
  rejected: number;
}

const codeLines = (raw: string) => [...new Set(raw.split('\n').map((l) => l.trim()).filter(Boolean))];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Paste a batch of ride codes from Uber. They are sealed on save and never shown again, anywhere:
 * the check step counts them, and the Done panel reports counts only.
 *
 * `secret`: nothing pasted here is kept on the device, not even across a step-up, because what was
 * pasted is a pile of redeemable codes, and a draft would leave them in the browser's session storage.
 */
export function UploadCodesFlow({ defaultProgram }: { defaultProgram: string }) {
  return (
    <AdminFlow<UploadValues>
      id="transport:upload-codes"
      secret
      title="Add ride codes"
      trigger={{ label: 'Add ride codes', variant: 'ghost' }}
      initial={{ program: defaultProgram, codes: '' }}
      steps={[
        {
          title: 'Paste the codes',
          lede: 'From Uber’s voucher dashboard, one code per line. Codes already added are ignored.',
          fields: ['codes', 'program'],
          render: (ctx) => (
            <>
              <TextField ctx={ctx} name="codes" label="Codes, one per line" multiline rows={8} spellCheck={false} hint="Up to 500 at a time, each up to 64 characters. They are locked away as soon as you add them and never shown again." />
              <TextField ctx={ctx} name="program" label="Programme" spellCheck={false} hint={`The pool guests claim from. “${defaultProgram}” unless you run more than one.`} />
            </>
          ),
          ready: (v) => codeLines(v.codes).length > 0 && PROGRAMME.test(v.program.trim()),
          readyHint: { field: 'codes', message: 'Paste at least one code, and give a programme in lowercase letters, numbers and dashes.' },
          next: async (v) => {
            const lines = codeLines(v.codes);
            if (lines.length > 500) return { errors: { codes: `That is ${lines.length} codes; add at most 500 at a time.` } };
            const long = lines.filter((l) => l.length > 64).length;
            if (long) return { errors: { codes: `${plural(long, 'line is', 'lines are')} longer than 64 characters, so not a ride code. Check what was pasted.` } };
            return undefined;
          },
        },
        {
          title: 'Check and add',
          render: (ctx) => (
            <ReviewList
              items={[
                { label: 'Codes', value: plural(codeLines(ctx.values.codes).length, 'code', 'codes') },
                { label: 'Programme', value: ctx.values.program.trim() },
              ]}
            />
          ),
        },
      ]}
      submit={{
        label: 'Add the codes',
        capability: 'admin_upload_transportation_codes',
        success: 'Codes added.',
        input: (v) => ({ program: v.program.trim(), codes: codeLines(v.codes) }),
        result: (data) => {
          const d = data as UploadResult;
          return (
            <p>
              {plural(d.added, 'code', 'codes')} added to {d.program}
              {d.duplicates ? `, ${plural(d.duplicates, 'duplicate', 'duplicates')} ignored` : ''}
              {d.rejected ? `, ${plural(d.rejected, 'line', 'lines')} rejected` : ''}. The codes themselves are not shown again.
            </p>
          );
        },
      }}
    />
  );
}
