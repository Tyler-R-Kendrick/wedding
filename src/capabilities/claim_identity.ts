import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { authSessions, guests } from '@/db/schema';
import { getGuest, guestDisplayName } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingForGuest, activeBindingsForIdentity, bindIdentity, getAuthUser } from '@/domain/identity/bindings';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { findInvitationByToken } from '@/domain/invitations/repo';
import { requireGuest } from '@/lib/principal';
import { actorOf, authOf } from './identity/shared';

const input = z.object({
  guestId: z.string().min(1).max(64),
  /** Invitation link for the guest's household, required when the household is not already yours. */
  token: z.string().min(1).max(128).optional(),
});

const output = z.discriminatedUnion('status', [
  z.object({ status: z.literal('bound'), guestId: z.string(), displayName: z.string(), role: z.enum(['self']) }),
  z.object({ status: z.literal('managed'), guestId: z.string(), displayName: z.string(), managerGuestId: z.string() }),
]);

export type ClaimIdentityResult = z.infer<typeof output>;

/**
 * Signed-in claim: link another invitation member to this verified inbox. Two shapes:
 *  - the member's own address is this inbox (spouses sharing an email): bind `self` and switch to them;
 *  - the member has no address and belongs to a household this person manages (or whose link they hold):
 *    record this person as their manager (no binding — children and no-email adults never sign in).
 * A member bound to a different inbox is never taken over. Fresh session required (identity action).
 */
export const claimIdentity = defineCapability<z.infer<typeof input>, ClaimIdentityResult>({
  name: 'claim_identity',
  title: 'Claim an invitation member',
  description: 'Links another person on the invitation to the signed-in email (shared inbox), or takes over managing a household member who has no email. Never overrides someone else’s claim.',
  kind: 'action',
  auth: 'guest',
  requires: [],
  stepUp: true,
  confirmation: 'inline',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const principal = requireGuest(ctx.principal);
    const { db } = await authOf(ctx);
    const user = await getAuthUser(db, principal.authIdentityId);
    const target = await getGuest(db, i.guestId);
    if (!user || !target || target.mergedIntoGuestId) return err(new CapabilityError('not_found', 'We could not find that person on the invitation.'));
    const household = await getHousehold(db, target.householdId);
    if (!household) return err(new CapabilityError('not_found', 'We could not find that person on the invitation.'));

    // Authority over the household: same household, manager of it, or holder of its live link.
    let householdAccess = household.id === principal.householdId || principal.actsFor.includes(target.id as never);
    if (!householdAccess && i.token) {
      const invitation = await findInvitationByToken(db, i.token);
      const lifecycle = invitation ? invitationLifecycle(invitation, ctx.now) : 'revoked';
      householdAccess = !!invitation && invitation.householdId === household.id && (lifecycle === 'active' || lifecycle === 'claimed');
    }
    if (!householdAccess) return err(new CapabilityError('forbidden', 'That person is on a different invitation. Open their invitation link to continue.'));

    const existing = await activeBindingForGuest(db, target.id);
    if (existing && existing.authIdentityId !== principal.authIdentityId) {
      return err(new CapabilityError('conflict', 'That person has already claimed their invitation with another email. If that’s wrong, please get in touch with Sara and Tyler.'));
    }
    const isChild = target.kind === 'child' || target.isMinor;
    if (!isChild && target.email && target.email === user.email) {
      const bound = existing ? ok(existing) : await bindIdentity(db, { authIdentityId: principal.authIdentityId, guestId: target.id, role: 'self', claimMethod: 'otp', invitationId: null, actor: actorOf(ctx), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
      if (!bound.ok) return err(bound.error);
      await db.update(authSessions).set({ activeGuestId: target.id }).where(eq(authSessions.id, principal.sessionId));
      return ok({ data: { status: 'bound', guestId: target.id, displayName: guestDisplayName(target), role: 'self' }, sources: [] });
    }
    if (target.email && target.email !== user.email && !isChild) {
      return err(new CapabilityError('forbidden', 'That person has their own email on the invitation — they can sign in with it, or ask Sara and Tyler to update it.'));
    }
    // No inbox of their own: this person manages them.
    const selves = (await activeBindingsForIdentity(db, principal.authIdentityId)).filter((b) => b.role === 'self').map((b) => b.guestId);
    if (!selves.includes(principal.guestId)) return err(new CapabilityError('forbidden', 'Sign in as yourself first.'));
    await db.update(guests).set({ managedByGuestId: principal.guestId, updatedAt: ctx.now }).where(eq(guests.id, target.id));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'identity.bound', target: { type: 'guest', id: target.id }, outcome: 'success', requestId: ctx.requestId, metadata: { role: 'managed_by', managerGuestId: principal.guestId } });
    return ok({ data: { status: 'managed', guestId: target.id, displayName: guestDisplayName(target), managerGuestId: principal.guestId }, sources: [] });
  },
});
