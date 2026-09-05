import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { GUEST_KINDS } from '@/db/schema';
import { guestDisplayName, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingsForGuests } from '@/domain/identity/bindings';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { findInvitationByToken } from '@/domain/invitations/repo';
import { consumeLimits, ipHashOf, OTP_LIMITS, RECOVERY } from './identity/shared';

const input = z.object({ token: z.string().min(1).max(128) });

const member = z.object({
  guestId: z.string(),
  displayName: z.string(),
  kind: z.enum(GUEST_KINDS),
  isMinor: z.boolean(),
  /** Whether this person can be picked in the claim step. */
  claimable: z.boolean(),
  /** How the code will be delivered if picked: their own inbox, the household manager's, or nobody's (contact the couple). */
  claimVia: z.enum(['own_email', 'manager_email', 'none']),
  /** Already linked to a verified inbox: the link cannot take over; sign in with that email instead. */
  claimed: z.boolean(),
  managerName: z.string().nullable(),
});

const output = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    household: z.object({ id: z.string(), name: z.string() }),
    members: z.array(member),
    events: z.array(z.string()),
    plusOneAllowance: z.number().int(),
    childrenAllowance: z.number().int(),
    lifecycle: z.enum(['active', 'claimed']),
  }),
  z.object({ status: z.enum(['unknown', 'expired', 'revoked']), recovery: z.object({ title: z.string(), message: z.string() }) }),
]);

export type InvitationLookup = z.infer<typeof output>;

/**
 * Discovery only (ADR-0001 rule 1): shows the household as printed and who can claim. Never
 * creates a session, never reveals emails. Unknown, malformed, expired, and revoked tokens
 * each get a kind recovery message; rate-limited per IP.
 */
export const lookupInvitation = defineCapability<z.infer<typeof input>, InvitationLookup>({
  name: 'lookup_invitation',
  title: 'Look up an invitation',
  description: 'Given an invitation link token, shows the household it was addressed to and which members can claim access. Read-only; grants nothing.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const limited = await consumeLimits(ctx, [{ key: `invite:lookup:${ipHashOf(ctx)}`, policy: OTP_LIMITS.lookupPerIp }]);
    if (!limited.ok) return err(limited.error);
    const { db } = appServices(ctx);
    const invitation = await findInvitationByToken(db, i.token);
    if (!invitation) return ok({ data: { status: 'unknown', recovery: RECOVERY.unknown }, sources: [] });
    const lifecycle = invitationLifecycle(invitation, ctx.now);
    if (lifecycle === 'expired' || lifecycle === 'revoked') return ok({ data: { status: lifecycle, recovery: RECOVERY[lifecycle] }, sources: [] });
    const household = await getHousehold(db, invitation.householdId);
    if (!household) return ok({ data: { status: 'unknown', recovery: RECOVERY.unknown }, sources: [] });
    const members = await listHouseholdMembers(db, household.id);
    const bindings = await activeBindingsForGuests(db, members.map((m) => m.id));
    const manager = members.find((m) => m.id === household.managerGuestId) ?? members.find((m) => m.kind !== 'child' && !m.isMinor && (!!m.email || bindings.has(m.id))) ?? null;
    const managerReachable = !!manager && (!!manager.email || bindings.has(manager.id));
    return ok({
      data: {
        status: 'found',
        household: { id: household.id, name: household.name },
        members: members.map((m) => {
          const isChild = m.kind === 'child' || m.isMinor;
          const own = !!m.email || bindings.has(m.id);
          const explicitManager = m.managedByGuestId ? members.find((x) => x.id === m.managedByGuestId) ?? null : null;
          const via = own ? 'own_email' : managerReachable || (explicitManager && (explicitManager.email || bindings.has(explicitManager.id))) ? 'manager_email' : 'none';
          return {
            guestId: m.id,
            displayName: guestDisplayName(m),
            kind: m.kind,
            isMinor: m.isMinor,
            claimable: !isChild && via !== 'none',
            claimVia: isChild ? 'none' : via,
            claimed: bindings.has(m.id),
            managerName: isChild ? (manager ? guestDisplayName(manager) : null) : via === 'manager_email' ? guestDisplayName(explicitManager ?? manager!) : null,
          };
        }),
        events: invitation.eventKeys,
        plusOneAllowance: invitation.plusOneAllowance,
        childrenAllowance: invitation.childrenAllowance,
        lifecycle,
      },
      sources: [],
    });
  },
});
