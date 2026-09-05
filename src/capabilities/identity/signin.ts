import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok, type Result } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { authSessions, guests } from '@/db/schema';
import { guestDisplayName } from '@/domain/guests/repo';
import { activeBindingForGuest, activeBindingsForIdentity, bindIdentity } from '@/domain/identity/bindings';
import type { ChallengePayload } from '@/domain/identity/challenge';
import { hashOtpIdentifier, getOtpLockout } from '@/domain/identity/otp';
import { markInvitationClaimed } from '@/domain/invitations/repo';
import { resolveAdminRoles } from '@/domain/identity/principal';
import { getAuthSession } from '@/lib/auth';
import { env } from '@/lib/env';
import type { CookieSink } from '@/lib/auth';
import { actorOf, authOf, callAuth, consumeLimits, EXPIRED_CODE_MESSAGE, INVALID_CODE_MESSAGE, ipHashOf, LOCKED_MESSAGE, logOtp, otpBuckets } from './shared';

export interface SignInOutcome {
  status: 'signed_in';
  kind: ChallengePayload['kind'];
  /** Guest the session now acts as (null for admins or an inbox with no claimable guest). */
  guestId: string | null;
  householdId: string | null;
  /** Other guests bound to this inbox the person may switch to (shared inbox). */
  candidates: { guestId: string; displayName: string }[];
  isAdmin: boolean;
  authenticatedAt: string;
  next: string | null;
}

/**
 * Shared by verify_otp and step_up: verifies the code with Better Auth (which consumes it
 * atomically and mints a fresh session), enforces the lockout and per-email/IP verify limits,
 * logs the attempt, then applies the challenge's meaning (claim binding, sign-in binding,
 * step-up rotation) and pins the active guest on the new session.
 */
export async function completeOtpSignIn(
  ctx: CapabilityContext,
  challenge: ChallengePayload,
  code: string,
  transport: { headers: Headers; sink: CookieSink },
): Promise<Result<SignInOutcome, CapabilityError>> {
  const { db, auth } = await authOf(ctx);
  const emailHash = hashOtpIdentifier(challenge.email ?? 'unknown');
  const limited = await consumeLimits(ctx, otpBuckets(ctx, 'verify', emailHash));
  if (!limited.ok) {
    await logOtp(ctx, { emailHash, purpose: challenge.kind, kind: 'verify', outcome: 'rate_limited' });
    return err(limited.error);
  }
  const lock = await getOtpLockout(db, emailHash, ipHashOf(ctx), ctx.now);
  if (lock.locked) {
    await logOtp(ctx, { emailHash, purpose: challenge.kind, kind: 'verify', outcome: 'locked' });
    return err(new CapabilityError('rate_limited', LOCKED_MESSAGE, { retryAfterMs: Math.max(1000, Date.parse(lock.until!) - ctx.now.getTime()) }));
  }
  if (!challenge.email) {
    // Nothing was ever sent for this challenge: behave exactly like a wrong code.
    await logOtp(ctx, { emailHash, purpose: challenge.kind, kind: 'verify', outcome: 'failed' });
    return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
  }

  // The session that made this request (if any) is rotated: sign-in always mints a new one.
  const previous = await getAuthSession(transport.headers, { db, disableRefresh: true }).catch(() => null);
  const guestName = challenge.guestIds[0] ? await db.select({ firstName: guests.firstName, lastName: guests.lastName }).from(guests).where(eq(guests.id, challenge.guestIds[0])).limit(1).then((r) => r[0]) : undefined;

  const signed = await callAuth(transport.sink, () =>
    auth.api.signInEmailOTP({
      body: { email: challenge.email!, otp: code, name: guestName ? [guestName.firstName, guestName.lastName].filter(Boolean).join(' ') : '' },
      headers: transport.headers,
      returnHeaders: true,
    }),
  );
  if (!signed.ok) {
    const c = signed.error.code;
    const outcome = c === 'TOO_MANY_ATTEMPTS' ? 'locked' : 'failed';
    await logOtp(ctx, { emailHash, purpose: challenge.kind, kind: 'verify', outcome });
    if (c === 'OTP_EXPIRED') return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }], reason: 'expired' }));
    if (c === 'TOO_MANY_ATTEMPTS') return err(new CapabilityError('rate_limited', LOCKED_MESSAGE, { retryAfterMs: 15 * 60_000 }));
    return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
  }
  await logOtp(ctx, { emailHash, purpose: challenge.kind, kind: 'verify', outcome: 'verified' });
  const { token: sessionToken, user } = signed.value.response;
  if (challenge.userId && challenge.userId !== user.id) {
    // A step-up challenge for a different identity: end the new session and refuse.
    await db.delete(authSessions).where(eq(authSessions.token, sessionToken));
    return err(new CapabilityError('forbidden', 'That code was not issued for this sign-in.'));
  }
  if (previous?.session.token && previous.session.token !== sessionToken) await db.delete(authSessions).where(eq(authSessions.token, previous.session.token));

  const actor = actorOf(ctx);
  let activeGuestId: string | null = previous?.session.activeGuestId ?? null;
  const candidates: SignInOutcome['candidates'] = [];
  const isAdmin = (await resolveAdminRoles(db, user.email, env.ADMIN_EMAILS)).size > 0;

  if (challenge.kind === 'claim' || challenge.kind === 'sign_in') {
    for (const guestId of challenge.guestIds) {
      const existing = await activeBindingForGuest(db, guestId);
      if (existing && existing.authIdentityId !== user.id) continue; // owned by another inbox: never taken over
      const bound = existing ? ok(existing) : await bindIdentity(db, { authIdentityId: user.id, guestId, role: 'self', claimMethod: 'otp', invitationId: challenge.invitationId, actor, requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
      if (!bound.ok) continue;
      activeGuestId ??= guestId;
      if (challenge.kind === 'claim' && challenge.invitationId) {
        await markInvitationClaimed(db, challenge.invitationId, ctx.now);
        await ctx.audit.record({ actor: { kind: 'guest', guestId: guestId as never, householdId: '' as never }, action: 'invitation.claimed', target: { type: 'invitation', id: challenge.invitationId }, outcome: 'success', requestId: ctx.requestId, metadata: { guestId } });
      }
    }
    for (const managed of challenge.managedGuestIds ?? []) {
      if (!activeGuestId) break;
      await db.update(guests).set({ managedByGuestId: activeGuestId, updatedAt: ctx.now }).where(eq(guests.id, managed));
    }
    if (!activeGuestId) {
      // Sign-in by an inbox whose guests are all bound elsewhere, or a claim that failed: fall back to any existing binding.
      const own = await activeBindingsForIdentity(db, user.id);
      activeGuestId = own.find((b) => b.role === 'self')?.guestId ?? own[0]?.guestId ?? null;
    }
  } else if (challenge.kind === 'step_up') {
    await ctx.audit.record({ actor, action: 'session.step_up', target: { type: 'auth_identity', id: user.id }, outcome: 'success', requestId: ctx.requestId, metadata: { method: 'otp' } });
  }

  // Shared inbox: list the other selves so the UI can offer "not you? pick yourself".
  const own = await activeBindingsForIdentity(db, user.id);
  const selfIds = own.filter((b) => b.role === 'self').map((b) => b.guestId);
  if (selfIds.length > 1) {
    const rows = await db.select().from(guests).where(and(inArray(guests.id, selfIds), isNull(guests.mergedIntoGuestId)));
    for (const g of rows) candidates.push({ guestId: g.id, displayName: guestDisplayName(g) });
  }
  const [updated] = await db.update(authSessions).set({ activeGuestId, authenticatedAt: ctx.now }).where(eq(authSessions.token, sessionToken)).returning({ authenticatedAt: authSessions.authenticatedAt });
  const householdId = activeGuestId ? ((await db.select({ householdId: guests.householdId }).from(guests).where(eq(guests.id, activeGuestId)).limit(1))[0]?.householdId ?? null) : null;
  appServices(ctx).metrics?.counter('auth.sign_in', 1, { kind: challenge.kind });
  return ok({
    status: 'signed_in',
    kind: challenge.kind,
    guestId: activeGuestId,
    householdId,
    candidates,
    isAdmin,
    authenticatedAt: (updated?.authenticatedAt ?? ctx.now).toISOString(),
    next: challenge.next ?? null,
  });
}
