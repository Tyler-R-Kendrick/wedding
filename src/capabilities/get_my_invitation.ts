import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { GUEST_KINDS } from '@/db/schema';
import { getGuest, guestDisplayName, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingsForGuests, getAuthUser } from '@/domain/identity/bindings';
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
      /**
       * What "I'm <name>" would actually do for THIS reader — the welcome page offered the button
       * to every adult member unfiltered, and three of the outcomes are guaranteed refusals
       * (`claim_identity`): someone with their own inbox is told to sign in with it, and someone
       * without one can only be taken on by their household manager. A button that cannot work is
       * not an offer.
       *
       *   `switch`             — this inbox is theirs too (a shared address): you become them.
       *   `manage`             — no email of their own and you may act for them; you keep your session.
       *   `own_inbox`          — their own address is on the invitation; they sign in with it.
       *   `not_manager`        — no email of their own, and only the household manager may act for them.
       *   `claimed_elsewhere`  — already bound to a different inbox; only the couple can undo that.
       */
      claimAction: z.enum(['switch', 'manage', 'own_inbox', 'not_manager', 'claimed_elsewhere']),
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
  // About the caller's own guest identity: an admin clears the `guest` floor but has none.
  guestIdentityRequired: true,
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
    const [me, household, user] = await Promise.all([getGuest(db, p.guestId), getHousehold(db, p.householdId), getAuthUser(db, p.authIdentityId)]);
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
        // Mirrors `claim_identity`'s own order of tests, so the button offered and the answer it
        // gets cannot disagree. `selfBind` there is "no verified inbox and no email of their own".
        members: members.map((m) => {
          const managedByYou = m.id !== me.id && p.actsFor.includes(m.id as never);
          // `claim_identity` binds you TO someone only when their address on the invitation is this
          // very inbox (a couple sharing one). Anything else is either theirs to sign in with, or a
          // household-manager act, or already spoken for.
          const sharesThisInbox = !!m.email && !!user?.email && m.email === user.email;
          const boundElsewhere = bindings.get(m.id)?.authIdentityId !== undefined && bindings.get(m.id)!.authIdentityId !== p.authIdentityId;
          const mayManage = p.guestId === household.managerGuestId || m.managedByGuestId === p.guestId || (m.managedByGuestId === null && household.managerGuestId === null);
          return {
            guestId: m.id,
            displayName: guestDisplayName(m),
            kind: m.kind,
            isMinor: m.isMinor,
            isYou: m.id === me.id,
            managedByYou,
            claimed: bindings.has(m.id),
            claimAction: (boundElsewhere ? 'claimed_elsewhere' : sharesThisInbox ? 'switch' : m.email ? 'own_inbox' : mayManage ? 'manage' : 'not_manager') as 'switch' | 'manage' | 'own_inbox' | 'not_manager' | 'claimed_elsewhere',
          };
        }),
      },
      sources: [],
    });
  },
});
