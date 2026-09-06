import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { guests } from '@/db/schema';
import { activeBindingsForIdentity, getAuthUser } from '@/domain/identity/bindings';
import { consumeChallenge, issueChallenge, readChallenge } from '@/domain/identity/challenge';
import { isEmailShape, maskEmail, normalizeEmail } from '@/domain/identity/mask';
import { getOtpLockout, hashOtpIdentifier } from '@/domain/identity/otp';
import { OTP_PURPOSE_HEADER } from '@/lib/auth';
import { actorOf, authOf, callAuth, challengeSecret, challengeStore, consumeLimits, EXPIRED_CODE_MESSAGE, INVALID_CODE_MESSAGE, ipHashOf, LOCKED_MESSAGE, logOtp, otpBuckets, requireCookieTransport, guestOf } from './identity/shared';

const input = z.object({
  email: z.string().min(3).max(254),
  /** Second step: the challenge returned by the first call and the code sent to the new address. */
  challenge: z.string().min(16).max(4096).optional(),
  code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.').optional(),
});

const output = z.discriminatedUnion('status', [
  z.object({ status: z.literal('verification_sent'), challenge: z.string(), expiresAt: z.string(), deliveredTo: z.string() }),
  z.object({ status: z.literal('updated'), email: z.string() }),
]);

export type UpdateMyContactResult = z.infer<typeof output>;

/**
 * Changes the signed-in guest's email in two steps: send a code to the *new* address, then
 * confirm it. Both the auth identity and every guest bound to it move to the new address, so
 * later sign-ins and OTPs go to the inbox the guest actually reads. Fresh session required.
 */
export const updateMyContact = defineCapability<z.infer<typeof input>, UpdateMyContactResult>({
  name: 'update_my_contact',
  title: 'Update my email',
  description: 'Changes the email address Sara and Tyler have on file for the signed-in guest. Sends a confirmation code to the new address first; the change applies only after the code is confirmed.',
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
    const guard = guestOf(ctx);
    if (!guard.ok) return err(guard.error);
    const p = guard.value;
    const transport = requireCookieTransport(ctx);
    if (!transport.ok) return err(transport.error);
    const { db, auth } = await authOf(ctx);
    const user = await getAuthUser(db, p.authIdentityId);
    if (!user) return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
    const newEmail = normalizeEmail(i.email);
    if (!isEmailShape(newEmail)) return err(new CapabilityError('validation', 'That email address does not look right.', { issues: [{ path: 'email', message: 'Enter a valid email address.' }] }));
    const selfGuestIds = (await activeBindingsForIdentity(db, p.authIdentityId)).filter((b) => b.role === 'self').map((b) => b.guestId);

    if (newEmail === user.email) {
      await db.update(guests).set({ email: newEmail, updatedAt: ctx.now }).where(inArray(guests.id, selfGuestIds));
      return ok({ data: { status: 'updated', email: maskEmail(newEmail) }, sources: [] });
    }

    const emailHash = hashOtpIdentifier(newEmail);
    if (!i.code) {
      const limited = await consumeLimits(ctx, otpBuckets(ctx, 'send', emailHash));
      if (!limited.ok) return err(limited.error);
      const headers = new Headers(transport.value.headers);
      headers.set(OTP_PURPOSE_HEADER, 'bind_identity');
      const sent = await callAuth(transport.value.sink, () => auth.api.requestEmailChangeEmailOTP({ body: { newEmail }, headers }));
      if (!sent.ok) {
        if (sent.error.status === 401) return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
        return err(new CapabilityError('provider_unavailable', 'We couldn’t send the code just now. Please try again in a moment.'));
      }
      await logOtp(ctx, { emailHash, purpose: 'change_email', kind: 'send', outcome: 'sent' });
      const { token, expiresAt } = await issueChallenge(challengeStore(ctx), challengeSecret(), { kind: 'change_email', email: newEmail, guestIds: selfGuestIds, invitationId: null, userId: user.id }, { now: ctx.now });
      return ok({ data: { status: 'verification_sent', challenge: token, expiresAt, deliveredTo: maskEmail(newEmail) }, sources: [] });
    }

    const store = challengeStore(ctx);
    const challenge = await readChallenge(store, challengeSecret(), i.challenge, ctx.now);
    if (!challenge || challenge.kind !== 'change_email' || challenge.userId !== user.id || challenge.email !== newEmail) {
      return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }] }));
    }
    const limited = await consumeLimits(ctx, otpBuckets(ctx, 'verify', emailHash));
    if (!limited.ok) return err(limited.error);
    const lock = await getOtpLockout(db, emailHash, ipHashOf(ctx), ctx.now);
    if (lock.locked) {
      await logOtp(ctx, { emailHash, purpose: 'change_email', kind: 'verify', outcome: 'locked' });
      return err(new CapabilityError('rate_limited', LOCKED_MESSAGE, { retryAfterMs: Math.max(1000, Date.parse(lock.until!) - ctx.now.getTime()) }));
    }
    const changed = await callAuth(transport.value.sink, () => auth.api.changeEmailEmailOTP({ body: { newEmail, otp: i.code! }, headers: transport.value.headers }));
    if (!changed.ok) {
      await logOtp(ctx, { emailHash, purpose: 'change_email', kind: 'verify', outcome: 'failed' });
      if (changed.error.code === 'OTP_EXPIRED') return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }] }));
      return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
    }
    await logOtp(ctx, { emailHash, purpose: 'change_email', kind: 'verify', outcome: 'verified' });
    await consumeChallenge(store, challengeSecret(), i.challenge);
    await db.update(guests).set({ email: newEmail, updatedAt: ctx.now }).where(inArray(guests.id, selfGuestIds));
    await ctx.audit.record({ actor: actorOf(ctx), action: 'identity.email_changed', target: { type: 'auth_identity', id: user.id }, outcome: 'success', requestId: ctx.requestId, metadata: { guests: selfGuestIds.length } });
    return ok({ data: { status: 'updated', email: maskEmail(newEmail) }, sources: [] });
  },
});
