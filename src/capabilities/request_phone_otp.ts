import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { requireService } from '@/capabilities/services';
import type { Db } from '@/db/client';
import { findGuestsByPhone } from '@/domain/guests/repo';
import { issueChallenge, type ChallengePayload } from '@/domain/identity/challenge';
import { getOtpLockout, hashOtpIdentifier } from '@/domain/identity/otp';
import { maskPhone, normalizePhoneE164 } from '@/domain/identity/phone';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { afterResponse } from '@/lib/after-response';
import { isPhoneSignInAvailable } from '@/lib/phone-sign-in';
import { authOf, challengeSecret, challengeStore, consumeLimits, holdToFloor, ipHashOf, logOtp, phoneBuckets, REQUEST_OTP_FLOOR_MS } from './identity/shared';

const input = z.object({ phone: z.string().min(7).max(32), next: z.string().max(512).optional() });

const output = z.object({
  sent: z.literal(true),
  challenge: z.string(),
  expiresAt: z.string(),
  deliveredTo: z.string(),
  lockedUntil: z.string().nullable(),
});

export type RequestPhoneOtpResult = z.infer<typeof output>;

/**
 * Sends a Twilio Verify SMS when the number matches a guest on file. Enumeration-resistant:
 * identical response whether or not the number is known (challenge returned either way).
 */
export const requestPhoneOtp = defineCapability<z.infer<typeof input>, RequestPhoneOtpResult>({
  name: 'request_phone_otp',
  title: 'Send an SMS sign-in code',
  description: 'Texts a six-digit code when the phone number matches a guest Sara and Tyler have on file.',
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
    if (!isPhoneSignInAvailable()) {
      return err(new CapabilityError('forbidden', 'Phone sign-in is not available on this site yet.', { reason: 'phone_sign_in_disabled' }));
    }
    const e164 = normalizePhoneE164(i.phone);
    if (!e164) return err(new CapabilityError('validation', 'Enter a mobile number with area code.', { issues: [{ path: 'phone', message: 'Enter a valid US mobile number.' }] }));
    const next = isSafeReturnPath(i.next) ? i.next : undefined;
    const db = requireService<Db>(ctx, 'db');
    const byGuest = (await findGuestsByPhone(db, e164)).filter((g) => g.kind !== 'child' && !g.isMinor);
    const guestIds = byGuest.map((g) => g.id);
    const phoneHash = hashOtpIdentifier(e164);
    const limited = await consumeLimits(ctx, phoneBuckets(ctx, 'send', phoneHash));
    if (!limited.ok) {
      await logOtp(ctx, { emailHash: phoneHash, purpose: 'phone_sign_in', kind: 'send', outcome: 'rate_limited' });
      return err(limited.error);
    }
    const payload: ChallengePayload = {
      kind: 'phone_sign_in',
      guestIds,
      invitationId: null,
      userId: null,
      email: null,
      phone: e164,
      smsSent: guestIds.length > 0,
      next,
    };
    if (guestIds.length > 0) {
      const twilio = appServices(ctx).providers('twilio-verify');
      const sent = await twilio.startVerification({ to: e164 });
      if (!sent.ok) appServices(ctx).logger?.warn({ class: sent.error.class }, 'phone otp send failed');
      payload.smsSent = sent.ok;
      afterResponse(() => logOtp(ctx, { emailHash: phoneHash, purpose: 'phone_sign_in', kind: 'send', outcome: sent.ok ? 'sent' : 'suppressed' }));
    } else {
      appServices(ctx).logger?.info({ purpose: 'phone_sign_in' }, 'phone otp not sent: no guest has this number');
      afterResponse(() => logOtp(ctx, { emailHash: phoneHash, purpose: 'phone_sign_in', kind: 'send', outcome: 'suppressed' }));
    }
    const { db: authDb } = await authOf(ctx);
    const { token, expiresAt } = await issueChallenge(challengeStore(ctx), challengeSecret(), payload, { now: ctx.now });
    const lock = await getOtpLockout(authDb, phoneHash, ipHashOf(ctx), ctx.now);
    await holdToFloor(startedMs, REQUEST_OTP_FLOOR_MS);
    return ok({ data: { sent: true, challenge: token, expiresAt, deliveredTo: maskPhone(e164), lockedUntil: lock.locked ? (lock.until ?? null) : null }, sources: [] });
  },
});
