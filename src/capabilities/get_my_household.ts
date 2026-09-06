import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { GUEST_KINDS } from '@/db/schema';
import { getGuestsByIds, guestDisplayName, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingsForGuests } from '@/domain/identity/bindings';
import { guestOf } from './identity/shared';

const input = z.object({}).optional();

const output = z.object({
  household: z.object({ id: z.string(), name: z.string(), managerGuestId: z.string().nullable(), managerName: z.string().nullable() }),
  members: z.array(
    z.object({
      guestId: z.string(),
      displayName: z.string(),
      kind: z.enum(GUEST_KINDS),
      isMinor: z.boolean(),
      isYou: z.boolean(),
      /** Signed in with a verified inbox. */
      claimed: z.boolean(),
      /** Only the household manager learns whether a member has an email on file (never the address). */
      hasEmail: z.boolean().nullable(),
      canActFor: z.boolean(),
    }),
  ),
  /** People outside this household the guest manages (e.g. a parent who also manages a grandparent). */
  alsoManaging: z.array(z.object({ guestId: z.string(), displayName: z.string(), householdId: z.string() })),
});

export type MyHousehold = z.infer<typeof output>;

/** Household roster for the signed-in guest. Contact details stay private: addresses are never returned here. */
export const getMyHousehold = defineCapability<z.infer<typeof input>, MyHousehold>({
  name: 'get_my_household',
  title: 'My household',
  description: 'Lists the people in the signed-in guest’s household, who manages the RSVP, who has claimed access, and whom the guest may act for. No email addresses or postal addresses.',
  kind: 'read',
  auth: 'guest',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 6_000,
  async handler(ctx) {
    const guard = guestOf(ctx);
    if (!guard.ok) return err(guard.error);
    const p = guard.value;
    const { db } = appServices(ctx);
    const household = await getHousehold(db, p.householdId);
    if (!household) return err(new CapabilityError('not_found', 'We could not find your household.'));
    const members = await listHouseholdMembers(db, household.id);
    const bindings = await activeBindingsForGuests(db, members.map((m) => m.id));
    const manager = members.find((m) => m.id === household.managerGuestId) ?? null;
    const isManager = p.entitlements.has('manage_household_rsvp');
    const outside = p.actsFor.filter((id) => !members.some((m) => m.id === id) && id !== p.guestId);
    const alsoManaging = (await getGuestsByIds(db, outside)).filter((g) => !g.mergedIntoGuestId).map((g) => ({ guestId: g.id, displayName: guestDisplayName(g), householdId: g.householdId }));
    return ok({
      data: {
        household: { id: household.id, name: household.name, managerGuestId: household.managerGuestId, managerName: manager ? guestDisplayName(manager) : null },
        members: members.map((m) => ({
          guestId: m.id,
          displayName: guestDisplayName(m),
          kind: m.kind,
          isMinor: m.isMinor,
          isYou: m.id === p.guestId,
          claimed: bindings.has(m.id),
          hasEmail: isManager || m.id === p.guestId ? !!m.email : null,
          canActFor: p.actsFor.includes(m.id as never),
        })),
        alsoManaging,
      },
      sources: [],
    });
  },
});
