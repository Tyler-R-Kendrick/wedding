import { createHash } from '@better-auth/utils/hash';
import { base64Url } from '@better-auth/utils/base64';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok, type Result } from '@/contracts/result';
import { authSessions, guestSignInPasses, guests } from '@/db/schema';
import { guestDisplayName } from '@/domain/guests/repo';
import { activeBindingForGuest, activeBindingsForIdentity, bindIdentity } from '@/domain/identity/bindings';
import {
  findGuestPassBySlug,
  guestPassLifecycle,
  GUEST_PASS_MAX_FAILED_ATTEMPTS,
  recordGuestPassFailure,
  resolveGuestPassSignInTarget,
  verifyGuestPassCode,
} from '@/domain/identity/guest-pass';
import { hashOtpIdentifier, getOtpLockout } from '@/domain/identity/otp';
import { resolveAdminRoles } from '@/domain/identity/principal';
import type { WeddingAuth } from '@/lib/auth/config';
import { env } from '@/lib/env';
import type { CookieSink } from '@/lib/auth';
import { getAuthSession } from '@/lib/auth';
import {
  actorOf,
  authOf,
  callAuth,
  consumeLimits,
  discardMintedSession,
  EXPIRED_CODE_MESSAGE,
  INVALID_CODE_MESSAGE,
  ipHashOf,
  LOCKED_MESSAGE,
  logOtp,
  otpBuckets,
} from '@/capabilities/identity/shared';
import type { SignInOutcome } from './signin';

async function hashOtpForBetterAuth(otp: string): Promise<string> {
  const hash = await createHash('SHA-256').digest(new TextEncoder().encode(otp));
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}

async function seedSignInOtp(auth: WeddingAuth, email: string, otp: string, expiresAt: Date): Promise<void> {
  const ctx = await auth.$context;
  const identifier = `sign-in-otp-${email.toLowerCase()}`;
  const stored = await hashOtpForBetterAuth(otp);
  await ctx.internalAdapter.deleteVerificationByIdentifier(identifier);
  await ctx.internalAdapter.createVerificationValue({
    identifier,
    value: `${stored}:0`,
    expiresAt,
  });
}

/**
 * Verifies an admin-issued pass code and signs the guest in (session cookie via transport).
 * Uses Better Auth's sign-in OTP path after seeding the verification row — no email is sent.
 */
export async function completeGuestPassSignIn(
  ctx: CapabilityContext,
  input: { slug: string; code: string },
  transport: { headers: Headers; sink: CookieSink },
): Promise<Result<SignInOutcome, CapabilityError>> {
  const { db, auth } = await authOf(ctx);
  const pass = await findGuestPassBySlug(db, input.slug);
  if (!pass) {
    return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
  }
  const lifecycle = guestPassLifecycle(pass, ctx.now);
  if (lifecycle === 'revoked') {
    return err(new CapabilityError('validation', 'This sign-in link is no longer active.', { issues: [{ path: 'code', message: 'This sign-in link is no longer active.' }], reason: 'revoked' }));
  }
  if (lifecycle === 'expired') {
    return err(new CapabilityError('validation', EXPIRED_CODE_MESSAGE, { issues: [{ path: 'code', message: EXPIRED_CODE_MESSAGE }], reason: 'expired' }));
  }
  if (pass.failedAttempts >= GUEST_PASS_MAX_FAILED_ATTEMPTS) {
    return err(new CapabilityError('validation', 'This sign-in link has too many wrong attempts. Ask Sara and Tyler for a fresh link.', { issues: [{ path: 'code', message: 'Too many wrong attempts.' }] }));
  }

  const target = await resolveGuestPassSignInTarget(db, pass.guestId);
  if (!target.ok) return err(target.error);
  const emailHash = hashOtpIdentifier(target.value.email);
  const limited = await consumeLimits(ctx, [
    ...otpBuckets(ctx, 'verify', emailHash),
    { key: `guest-pass:verify:${pass.id}:${ipHashOf(ctx)}`, policy: { capacity: 15, refillPerSecond: 15 / 600, failMode: 'closed' as const } },
    { key: `guest-pass:verify:slug:${pass.slug}:${ipHashOf(ctx)}`, policy: { capacity: 15, refillPerSecond: 15 / 600, failMode: 'closed' as const } },
  ]);
  if (!limited.ok) {
    await logOtp(ctx, { emailHash, purpose: 'guest_pass', kind: 'verify', outcome: 'rate_limited' });
    return err(limited.error);
  }
  const lock = await getOtpLockout(db, emailHash, ipHashOf(ctx), ctx.now);
  if (lock.locked) {
    await logOtp(ctx, { emailHash, purpose: 'guest_pass', kind: 'verify', outcome: 'locked' });
    return err(new CapabilityError('rate_limited', LOCKED_MESSAGE, { retryAfterMs: Math.max(1000, Date.parse(lock.until!) - ctx.now.getTime()) }));
  }

  const normalized = input.code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized) || !(await verifyGuestPassCode(db, pass, normalized))) {
    await recordGuestPassFailure(db, pass.id);
    await logOtp(ctx, { emailHash, purpose: 'guest_pass', kind: 'verify', outcome: 'failed' });
    return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
  }

  const previous = await getAuthSession(transport.headers, { db, disableRefresh: true }).catch(() => null);
  await seedSignInOtp(auth, target.value.email, normalized, pass.expiresAt);
  const guestName = await db.select().from(guests).where(eq(guests.id, pass.guestId)).limit(1).then((r) => r[0]);
  const signed = await callAuth(transport.sink, () =>
    auth.api.signInEmailOTP({
      body: { email: target.value.email, otp: normalized, name: guestName ? guestDisplayName(guestName) : '' },
      headers: transport.headers,
      returnHeaders: true,
    }),
  );
  if (!signed.ok) {
    await logOtp(ctx, { emailHash, purpose: 'guest_pass', kind: 'verify', outcome: 'failed' });
    return err(new CapabilityError('validation', INVALID_CODE_MESSAGE, { issues: [{ path: 'code', message: INVALID_CODE_MESSAGE }] }));
  }
  await logOtp(ctx, { emailHash, purpose: 'guest_pass', kind: 'verify', outcome: 'verified' });

  const { token: sessionToken, user } = signed.value.response;
  if (previous?.session.token && previous.session.token !== sessionToken) {
    await db.delete(authSessions).where(eq(authSessions.token, previous.session.token));
  }

  const actor = actorOf(ctx);
  let activeGuestId: string | null = target.value.activeGuestId;
  const candidates: SignInOutcome['candidates'] = [];

  for (const guestId of target.value.guestIds) {
    const existing = await activeBindingForGuest(db, guestId);
    if (existing && existing.authIdentityId !== user.id) continue;
    const bound = existing ? ok(existing) : await bindIdentity(db, { authIdentityId: user.id, guestId, role: 'self', claimMethod: 'pass', invitationId: target.value.invitationId, actor, requestId: ctx.requestId, audit: ctx.audit, now: ctx.now });
    if (!bound.ok) continue;
    activeGuestId ??= guestId;
  }
  for (const managed of target.value.managedGuestIds) {
    if (!activeGuestId) break;
    await db.update(guests).set({ managedByGuestId: activeGuestId, updatedAt: ctx.now }).where(eq(guests.id, managed));
  }
  if (!activeGuestId) {
    const own = await activeBindingsForIdentity(db, user.id);
    activeGuestId = own.find((b) => b.role === 'self')?.guestId ?? own[0]?.guestId ?? null;
    if (!activeGuestId) {
      await db.delete(authSessions).where(eq(authSessions.token, sessionToken));
      await discardMintedSession(transport);
      return err(new CapabilityError('validation', 'That code could not link you to a guest record. Sign in with your email instead.', { issues: [{ path: 'code', message: 'Could not link to a guest.' }] }));
    }
  }

  const own = await activeBindingsForIdentity(db, user.id);
  const selfIds = own.filter((b) => b.role === 'self').map((b) => b.guestId);
  if (selfIds.length > 1) {
    const rows = await db.select().from(guests).where(and(inArray(guests.id, selfIds), isNull(guests.mergedIntoGuestId)));
    for (const g of rows) candidates.push({ guestId: g.id, displayName: guestDisplayName(g) });
  }

  const isAdmin = (await resolveAdminRoles(db, user.email, env.ADMIN_EMAILS)).size > 0;
  const [updated] = await db
    .update(authSessions)
    .set({ activeGuestId, authenticatedAt: ctx.now })
    .where(eq(authSessions.token, sessionToken))
    .returning({ authenticatedAt: authSessions.authenticatedAt });

  await db.update(guestSignInPasses).set({ lastVerifiedAt: ctx.now }).where(eq(guestSignInPasses.id, pass.id));

  const householdId = activeGuestId ? ((await db.select({ householdId: guests.householdId }).from(guests).where(eq(guests.id, activeGuestId)).limit(1))[0]?.householdId ?? null) : null;

  return ok({
    status: 'signed_in',
    kind: 'sign_in',
    guestId: activeGuestId,
    householdId,
    candidates,
    isAdmin,
    authenticatedAt: (updated?.authenticatedAt ?? ctx.now).toISOString(),
    next: null,
  });
}
