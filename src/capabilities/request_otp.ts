import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { findGuestsByEmail, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingForGuest, activeBindingsForIdentity, findAuthUserByEmail, getAuthUser } from '@/domain/identity/bindings';
import { issueChallenge, type ChallengePayload } from '@/domain/identity/challenge';
import { isEmailShape, maskEmail, normalizeEmail } from '@/domain/identity/mask';
import { hashOtpIdentifier } from '@/domain/identity/otp';
import { resolveAdminRoles } from '@/domain/identity/principal';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { findInvitationByToken } from '@/domain/invitations/repo';
import { OTP_PURPOSE_HEADER } from '@/lib/auth';
import { env } from '@/lib/env';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { authOf, callAuth, challengeSecret, challengeStore, consumeLimits, holdToFloor, logOtp, otpBuckets, RECOVERY } from './identity/shared';

const input = z.discriminatedUnion('purpose', [
  z.object({ purpose: z.literal('claim'), token: z.string().min(1).max(128), guestId: z.string().min(1).max(64), next: z.string().max(256).optional() }),
  z.object({ purpose: z.literal('sign_in'), email: z.string().min(3).max(254), next: z.string().max(256).optional() }),
  z.object({ purpose: z.literal('admin_sign_in'), email: z.string().min(3).max(254), next: z.string().max(256).optional() }),
  z.object({ purpose: z.literal('step_up'), next: z.string().max(256).optional() }),
]);

const output = z.discriminatedUnion('sent', [
  z.object({
    sent: z.literal(true),
    /** Opaque, signed; hand it back to verify_otp together with the code. */
    challenge: z.string(),
    expiresAt: z.string(),
    /** Masked address (“t•••@g•••.com”) so the person knows which inbox to open. */
    deliveredTo: z.string(),
    /** Who the code was addressed to when the claim goes through a household manager. */
    deliveredFor: z.string().nullable(),
  }),
  z.object({ sent: z.literal(false), recovery: z.object({ title: z.string(), message: z.string() }) }),
]);

export type RequestOtpResult = z.infer<typeof output>;

const NO_EMAIL = { title: 'We don’t have an email on file yet', message: 'Reach out to Sara and Tyler with the address you’d like to use and they will set it up for you.' };

/**
 * Sends a one-time code. Enumeration-resistant: for `sign_in` and `admin_sign_in` the response
 * is identical whether or not the address is known (a signed challenge is returned either way
 * and nothing is sent for unknown addresses). For `claim`, the code always goes to the inbox
 * on file (or the bound inbox for an already-claimed guest) — never to a caller-supplied
 * address — so a forwarded link cannot take over anyone. Per-email and per-IP limits apply.
 */
export const requestOtp = defineCapability<z.infer<typeof input>, RequestOtpResult>({
  name: 'request_otp',
  title: 'Send a sign-in code',
  description: 'Emails a six-digit code to the inbox on file for an invitation member (claim), a known guest email (sign in), an administrator, or the current session (step-up). Returns a challenge to verify with.',
  kind: 'action',
  auth: 'anonymous',
  requires: [],
  confirmation: 'none',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const startedMs = performance.now();
    const { db, auth } = await authOf(ctx);
    const next = isSafeReturnPath(i.next) ? i.next : undefined;
    let email: string | null = null;
    let payload: Omit<ChallengePayload, 'email'>;
    let deliveredFor: string | null = null;
    let typedEmail: string | null = null;

    if (i.purpose === 'claim') {
      const invitation = await findInvitationByToken(db, i.token);
      if (!invitation) return ok({ data: { sent: false, recovery: RECOVERY.unknown }, sources: [] });
      const lifecycle = invitationLifecycle(invitation, ctx.now);
      if (lifecycle === 'expired' || lifecycle === 'revoked') return ok({ data: { sent: false, recovery: RECOVERY[lifecycle] }, sources: [] });
      const household = await getHousehold(db, invitation.householdId);
      const members = household ? await listHouseholdMembers(db, household.id) : [];
      const picked = members.find((m) => m.id === i.guestId);
      if (!household || !picked) return err(new CapabilityError('validation', 'Please pick a name from the invitation.', { issues: [{ path: 'guestId', message: 'Pick a name from the list.' }] }));
      if (picked.kind === 'child' || picked.isMinor) {
        return err(new CapabilityError('validation', 'Children are included through their household — pick the adult who manages the RSVP.', { issues: [{ path: 'guestId', message: 'Pick an adult.' }] }));
      }
      // Resolve the inbox: bound identity first (takeover-proof), then the guest's own address, then the manager's.
      const boundTo = await activeBindingForGuest(db, picked.id);
      let bindGuestId = picked.id;
      const managed: string[] = [];
      if (boundTo) email = (await getAuthUser(db, boundTo.authIdentityId))?.email ?? null;
      else if (picked.email) email = picked.email;
      else {
        const managerId = picked.managedByGuestId ?? household.managerGuestId;
        const manager = members.find((m) => m.id === managerId && m.kind !== 'child' && !m.isMinor) ?? members.find((m) => m.kind !== 'child' && !m.isMinor && !!m.email) ?? null;
        if (manager) {
          const managerBinding = await activeBindingForGuest(db, manager.id);
          email = managerBinding ? ((await getAuthUser(db, managerBinding.authIdentityId))?.email ?? null) : manager.email;
          bindGuestId = manager.id;
          managed.push(picked.id);
          deliveredFor = [manager.firstName, manager.lastName].filter(Boolean).join(' ');
        }
      }
      if (!email) return ok({ data: { sent: false, recovery: NO_EMAIL }, sources: [] });
      payload = { kind: 'claim', guestIds: [bindGuestId], managedGuestIds: managed, invitationId: invitation.id, userId: null, next };
    } else if (i.purpose === 'sign_in' || i.purpose === 'admin_sign_in') {
      typedEmail = normalizeEmail(i.email);
      if (!isEmailShape(typedEmail)) return err(new CapabilityError('validation', 'Enter the email address on your invitation.', { issues: [{ path: 'email', message: 'Enter a valid email address.' }] }));
      if (i.purpose === 'admin_sign_in') {
        const roles = await resolveAdminRoles(db, typedEmail, env.ADMIN_EMAILS);
        email = roles.size > 0 ? typedEmail : null;
        payload = { kind: 'admin_sign_in', guestIds: [], invitationId: null, userId: null, next };
      } else {
        const byGuest = (await findGuestsByEmail(db, typedEmail)).filter((g) => g.kind !== 'child' && !g.isMinor);
        const user = await findAuthUserByEmail(db, typedEmail);
        const byBinding = user ? (await activeBindingsForIdentity(db, user.id)).filter((b) => b.role === 'self').map((b) => b.guestId) : [];
        const guestIds = [...new Set([...byBinding, ...byGuest.map((g) => g.id)])];
        email = guestIds.length > 0 ? typedEmail : null;
        payload = { kind: 'sign_in', guestIds, invitationId: null, userId: null, next };
      }
    } else {
      const p = ctx.principal;
      if (p.kind !== 'guest' && p.kind !== 'admin') return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
      const user = await getAuthUser(db, p.authIdentityId);
      if (!user) return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
      email = user.email;
      payload = { kind: 'step_up', guestIds: [], invitationId: null, userId: user.id, next };
    }

    const limitEmail = email ?? typedEmail ?? 'unknown';
    const emailHash = hashOtpIdentifier(limitEmail);
    const limited = await consumeLimits(ctx, otpBuckets(ctx, 'send', emailHash));
    if (!limited.ok) {
      await logOtp(ctx, { emailHash, purpose: payload.kind, kind: 'send', outcome: 'rate_limited' });
      return err(limited.error);
    }

    // The send is never awaited on the request path (review S8): a known address must not answer
    // slower than an unknown one. Delivery outcome is logged when it settles.
    if (email) {
      const headers = new Headers({ [OTP_PURPOSE_HEADER]: payload.kind === 'admin_sign_in' ? 'admin_sign_in' : payload.kind === 'step_up' ? 'step_up' : 'sign_in' });
      const purpose = payload.kind;
      void callAuth({ setCookies: [] }, () => auth.api.sendVerificationOTP({ body: { email: email!, type: 'sign-in' }, headers }))
        .then(async (sent) => {
          if (!sent.ok) appServices(ctx).logger?.warn({ code: sent.error.code, purpose }, 'otp send failed');
          await logOtp(ctx, { emailHash, purpose, kind: 'send', outcome: sent.ok ? 'sent' : 'suppressed' });
        })
        .catch((e) => appServices(ctx).logger?.warn({ err: e }, 'otp send threw'));
    } else {
      void logOtp(ctx, { emailHash, purpose: payload.kind, kind: 'send', outcome: 'suppressed' });
    }
    const { token, expiresAt } = await issueChallenge(challengeStore(ctx), challengeSecret(), { ...payload, email }, { now: ctx.now });
    // Identical shape for known and unknown addresses; the mask is of the address the caller typed (or the one on file for claims).
    const shown = email ?? typedEmail ?? '';
    await holdToFloor(startedMs);
    return ok({ data: { sent: true, challenge: token, expiresAt, deliveredTo: maskEmail(shown), deliveredFor }, sources: [] });
  },
});
