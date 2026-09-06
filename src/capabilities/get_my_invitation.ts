import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { GUEST_KINDS } from '@/db/schema';
import { getGuest, guestDisplayName, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingsForGuests } from '@/domain/identity/bindings';
import { guestOf } from './identity/shared';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { currentInvitationForHousehold } from '@/domain/invitations/repo';

const input = z.object({}).optional();

const output = z.object({
  you: z.object({ guestId: z.string(), displayName: z.string(), isManager: z.boolean() }),
  household: z.object({ id: z.string(), name: z.string() }),
  invitation: z
    .object({
      status: z.enum(['active', 'claimed', 'expired', 'revoked']),
      events: z.array(z.string()),
      plusOneAllowance: z.number().int(),
      childrenAllowance: z.number().int(),
      claimedAt: z.string().nullable(),
    })
    .nullable(),
  members: z.array(
    z.object({
      guestId: z.string(),
      displayName: z.string(),
      kind: z.enum(GUEST_KINDS),
      isMinor: z.boolean(),
      isYou: z.boolean(),
      /** You may RSVP for this person (household manager semantics). */
      managedByYou: z.boolean(),
      claimed: z.boolean(),
    }),
  ),
});

export type MyInvitation = z.infer<typeof output>;

/** The signed-in guest's own invitation: names as printed, events covered, who they manage. No emails, no other households. */
export const getMyInvitation = defineCapability<z.infer<typeof input>, MyInvitation>({
  name: 'get_my_invitation',
  title: 'My invitation',
  description: 'Returns the signed-in guest’s invitation: household name, the people on it, which events it covers, plus-one and children allowances, and whom the guest may RSVP for. Read-only; never another household.',
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
    const [me, household] = await Promise.all([getGuest(db, p.guestId), getHousehold(db, p.householdId)]);
    if (!me || !household) return err(new CapabilityError('not_found', 'We could not find your invitation.'));
    const [invitation, members] = await Promise.all([currentInvitationForHousehold(db, household.id), listHouseholdMembers(db, household.id)]);
    const bindings = await activeBindingsForGuests(db, members.map((m) => m.id));
    return ok({
      data: {
        you: { guestId: me.id, displayName: guestDisplayName(me), isManager: p.entitlements.has('manage_household_rsvp') },
        household: { id: household.id, name: household.name },
        invitation: invitation
          ? { status: invitationLifecycle(invitation, ctx.now), events: invitation.eventKeys, plusOneAllowance: invitation.plusOneAllowance, childrenAllowance: invitation.childrenAllowance, claimedAt: invitation.claimedAt?.toISOString() ?? null }
          : null,
        members: members.map((m) => ({
          guestId: m.id,
          displayName: guestDisplayName(m),
          kind: m.kind,
          isMinor: m.isMinor,
          isYou: m.id === me.id,
          managedByYou: m.id !== me.id && p.actsFor.includes(m.id as never),
          claimed: bindings.has(m.id),
        })),
      },
      sources: [],
    });
  },
});
