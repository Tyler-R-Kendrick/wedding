import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { authSessions } from '@/db/schema';
import { consumeChallenge, readChallenge } from '@/domain/identity/challenge';
import { getAuthSession } from '@/lib/auth';
import { completeOtpSignIn } from './identity/signin';
import { actorOf, authOf, callAuth, challengeSecret, challengeStore, discardMintedSession, EXPIRED_CODE_MESSAGE, requireCookieTransport } from './identity/shared';

const input = z.union([
  z.object({ method: z.literal('otp'), challenge: z.string().min(16).max(4096), code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') }),
  z.object({ method: z.literal('passkey'), step: z.literal('options') }),
  z.object({ method: z.literal('passkey'), step: z.literal('verify'), response: z.record(z.string(), z.unknown()) }),
]);

const output = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fresh'), method: z.enum(['otp', 'passkey']), authenticatedAt: z.string() }),
  z.object({ status: z.literal('options'), options: z.record(z.string(), z.unknown()) }),
]);

export type StepUpResult = z.infer<typeof output>;

/**
 * Re-proves possession for consequential actions (ADR-0001 rule 4). OTP: verifies the code
 * from request_otp({purpose:'step_up'}). Passkey: two steps (options, verify). Either way a
 * fresh session replaces the current one (rotation) and `authenticatedAt` is stamped from the
 * server clock; the pipeline's stepUp gate then passes for 5 minutes.
 */
export const stepUp = defineCapability<z.infer<typeof input>, StepUpResult>({
  name: 'step_up',
  title: 'Confirm it’s you',
  description: 'Re-verifies the signed-in person with a fresh code or their passkey before a sensitive action (money, identity, external commitments).',
  kind: 'action',
  auth: 'guest',
  requires: [],
  confirmation: 'none',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const p = ctx.principal;
    if (p.kind !== 'guest' && p.kind !== 'admin') return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
    const transport = requireCookieTransport(ctx);
    if (!transport.ok) return err(transport.error);
    const { db, auth } = await authOf(ctx);

    if (i.method === 'otp') {
      const store = challengeStore(ctx);
      const challenge = await readChallenge(store, challengeSecret(), i.challenge, ctx.now);
      if (!challenge || challenge.kind !== 'step_up') return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }] }));
      if (challenge.userId !== p.authIdentityId) return err(new CapabilityError('forbidden', 'That code was not issued for this sign-in.'));
      const r = await completeOtpSignIn(ctx, challenge, i.code, transport.value);
      if (!r.ok) return err(r.error);
      await consumeChallenge(store, challengeSecret(), i.challenge);
      return ok({ data: { status: 'fresh', method: 'otp', authenticatedAt: r.value.authenticatedAt }, sources: [] });
    }

    if (i.step === 'options') {
      const r = await callAuth(transport.value.sink, () => auth.api.generatePasskeyAuthenticationOptions({ headers: transport.value.headers }));
      if (!r.ok) return err(new CapabilityError('provider_unavailable', 'Passkeys are not available right now. You can use a code instead.'));
      return ok({ data: { status: 'options', options: r.value as unknown as Record<string, unknown> }, sources: [] });
    }

    const previous = await getAuthSession(transport.value.headers, { db, disableRefresh: true }).catch(() => null);
    const verified = await callAuth(transport.value.sink, () => auth.api.verifyPasskeyAuthentication({ body: { response: i.response as never }, headers: transport.value.headers }));
    if (!verified.ok) return err(new CapabilityError('forbidden', 'That passkey could not be verified. Try again, or use a code.', { reason: verified.error.code }));
    const session = verified.value.session;
    if (session.userId !== p.authIdentityId) {
      await db.delete(authSessions).where(eq(authSessions.token, session.token));
      await discardMintedSession(transport.value);
      return err(new CapabilityError('forbidden', 'That passkey belongs to a different sign-in.'));
    }
    if (previous?.session.token && previous.session.token !== session.token) await db.delete(authSessions).where(eq(authSessions.token, previous.session.token));
    const [row] = await db
      .update(authSessions)
      .set({ authenticatedAt: ctx.now, activeGuestId: previous?.session.activeGuestId ?? (p.kind === 'guest' ? p.guestId : null) })
      .where(eq(authSessions.token, session.token))
      .returning({ authenticatedAt: authSessions.authenticatedAt });
    await ctx.audit.record({ actor: actorOf(ctx), action: 'session.step_up', target: { type: 'auth_identity', id: p.authIdentityId }, outcome: 'success', requestId: ctx.requestId, metadata: { method: 'passkey' } });
    return ok({ data: { status: 'fresh', method: 'passkey', authenticatedAt: (row?.authenticatedAt ?? ctx.now).toISOString() }, sources: [] });
  },
});
