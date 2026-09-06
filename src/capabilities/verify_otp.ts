import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { consumeChallenge, readChallenge } from '@/domain/identity/challenge';
import { completeOtpSignIn, type SignInOutcome } from './identity/signin';
import { challengeSecret, challengeStore, EXPIRED_CODE_MESSAGE, requireCookieTransport } from './identity/shared';

const input = z.object({ challenge: z.string().min(16).max(4096), code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') });

const output = z.object({
  status: z.literal('signed_in'),
  kind: z.enum(['claim', 'sign_in', 'step_up', 'admin_sign_in', 'change_email']),
  guestId: z.string().nullable(),
  householdId: z.string().nullable(),
  candidates: z.array(z.object({ guestId: z.string(), displayName: z.string() })),
  isAdmin: z.boolean(),
  authenticatedAt: z.string(),
  next: z.string().nullable(),
});

/**
 * Verifies a code for a challenge from request_otp and starts a fresh session (the cookie is
 * delivered by the transport, never in this response). A claim challenge also writes the
 * GuestAccessBinding and marks the invitation claimed. Wrong, expired, and never-sent codes all
 * answer with the same message; 5 failures lock the address for 15 minutes.
 */
export const verifyOtp = defineCapability<z.infer<typeof input>, SignInOutcome>({
  name: 'verify_otp',
  title: 'Verify a sign-in code',
  description: 'Checks the six-digit code the person received and signs them in, linking them to their invitation on a first claim.',
  kind: 'action',
  auth: 'anonymous',
  requires: [],
  confirmation: 'none',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const transport = requireCookieTransport(ctx);
    if (!transport.ok) return err(transport.error);
    const store = challengeStore(ctx);
    const challenge = await readChallenge(store, challengeSecret(), i.challenge, ctx.now);
    if (!challenge) return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }], reason: 'challenge' }));
    if (challenge.kind === 'change_email') return err(new CapabilityError('validation', 'Use “update my contact” to confirm a new email address.'));
    if (challenge.kind === 'step_up') return err(new CapabilityError('validation', 'Use the confirm-it’s-you step for this code.'));
    const result = await completeOtpSignIn(ctx, challenge, i.code, transport.value);
    if (!result.ok) return err(result.error);
    await consumeChallenge(store, challengeSecret(), i.challenge);
    return ok({ data: result.value, sources: [] });
  },
});
