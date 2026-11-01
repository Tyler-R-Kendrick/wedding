import { and, eq, isNull } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { authAccounts, authUsers, guests, invitations, socialAuthReviews, type SocialProvider, type SocialReviewReason } from '@/db/schema';
import { matchGuestsByName, type ProviderProfileName } from '@/domain/identity/name-match';
import { activeBindingForGuest, activeBindingsForIdentity, bindIdentity, ensureAuthUser, findAuthUserByEmail } from '@/domain/identity/bindings';
import { verifiedProviderEmail } from '@/domain/identity/social/admin-email';
import type { CookieSink } from '@/lib/auth';
import { establishGuestSession } from '@/lib/auth/establish-session';
import { getAuth } from '@/lib/auth';
import { hashOtpIdentifier } from '@/domain/identity/otp';
import { isSafeReturnPath, safeReturnPath } from '@/domain/identity/routes';
import { guestSignInLandingPath } from '@/domain/lifecycle/guest-portal';
import { resolveAdminRoles } from '@/domain/identity/principal';
import { invitationLifecycle } from '@/domain/identity/tokens';
import { env } from '@/lib/env';
import type { OAuthProfile } from './oauth';

export const PENDING_PATH = '/sign-in/pending';

export function syntheticSocialEmail(provider: SocialProvider, accountId: string): string {
  const slug = accountId.replace(/[^a-zA-Z0-9._+-]/g, '_').slice(0, 120);
  return `${provider}+${slug}@users.noreply.kendrick.wedding`.toLowerCase();
}

export function isSyntheticSocialEmail(email: string): boolean {
  return email.endsWith('@users.noreply.kendrick.wedding');
}

async function adminRolesForEmail(db: Db, email: string) {
  return resolveAdminRoles(db, email, env.ADMIN_EMAILS);
}

async function establishSocialSession(
  db: Db,
  sink: CookieSink,
  input: { userId: string; activeGuestId: string | null; redirectTo: string; started: number },
): Promise<SocialSignInResult> {
  const auth = await getAuth(db);
  await establishGuestSession(db, auth, sink, { userId: input.userId, activeGuestId: input.activeGuestId });
  await hold(input.started);
  return { ok: true, redirectTo: input.redirectTo };
}

async function completeAdminSocialSignIn(
  db: Db,
  sink: CookieSink,
  input: {
    provider: SocialProvider;
    profile: OAuthProfile;
    accessToken: string;
    adminEmail: string;
    next: string | null;
    started: number;
  },
): Promise<SocialSignInResult | null> {
  const displayName = [input.profile.givenName, input.profile.familyName].filter(Boolean).join(' ') || input.profile.name || 'Administrator';
  const userResult = await ensureAuthUser(db, input.adminEmail, displayName);
  if (!userResult.ok) return null;
  await linkProviderAccount(db, {
    userId: userResult.value.id,
    provider: input.provider,
    accountId: input.profile.providerAccountId,
    accessToken: input.accessToken,
  });
  const redirectTo = safeReturnPath(input.next, '/admin');
  return establishSocialSession(db, sink, { userId: userResult.value.id, activeGuestId: null, redirectTo, started: input.started });
}

async function findLinkedAccount(db: Db, provider: SocialProvider, accountId: string) {
  const rows = await db
    .select()
    .from(authAccounts)
    .where(and(eq(authAccounts.providerId, provider), eq(authAccounts.accountId, accountId)))
    .limit(1);
  return rows[0] ?? null;
}

async function linkProviderAccount(db: Db, input: { userId: string; provider: SocialProvider; accountId: string; accessToken?: string }) {
  const existing = await findLinkedAccount(db, input.provider, input.accountId);
  if (existing) return existing;
  const now = new Date();
  const [row] = await db
    .insert(authAccounts)
    .values({
      id: newId(),
      userId: input.userId,
      providerId: input.provider,
      accountId: input.accountId,
      issuer: input.provider,
      accessToken: input.accessToken ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

async function listMatchableGuests(db: Db) {
  return db
    .select({
      id: guests.id,
      firstName: guests.firstName,
      lastName: guests.lastName,
      alternateNames: guests.alternateNames,
      householdId: guests.householdId,
      kind: guests.kind,
      isMinor: guests.isMinor,
      mergedIntoGuestId: guests.mergedIntoGuestId,
    })
    .from(guests)
    .where(isNull(guests.mergedIntoGuestId));
}

async function invitationSentForGuest(db: Db, guestId: string): Promise<boolean> {
  const guest = (await db.select({ householdId: guests.householdId }).from(guests).where(eq(guests.id, guestId)).limit(1))[0];
  if (!guest) return false;
  const inv = await db
    .select({ sentAt: invitations.sentAt, status: invitations.status, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(eq(invitations.householdId, guest.householdId))
    .orderBy(invitations.issuedAt)
    .limit(5);
  const usable = inv.filter((i) => {
    const life = invitationLifecycle(i);
    return life === 'active' || life === 'claimed';
  });
  if (!usable.length) return false;
  return usable.some((i) => i.sentAt != null);
}

export async function enqueueSocialReview(
  db: Db,
  input: {
    provider: SocialProvider;
    profile: ProviderProfileName;
    providerAccountId: string;
    reason: SocialReviewReason;
    candidateGuestIds: string[];
    ipHash: string;
  },
) {
  const now = new Date();
  await db.insert(socialAuthReviews).values({
    id: newId(),
    providerId: input.provider,
    providerAccountId: input.providerAccountId,
    profileName: input.profile,
    reason: input.reason,
    candidateGuestIds: input.candidateGuestIds,
    status: 'open',
    ipHash: input.ipHash,
    createdAt: now,
  });
}

export type SocialSignInResult = { ok: true; redirectTo: string } | { ok: false; redirectTo: string };

/**
 * Completes a social OAuth callback: linked accounts sign in immediately; otherwise name-match.
 */
export async function completeSocialSignIn(
  db: Db,
  sink: CookieSink,
  input: {
    provider: SocialProvider;
    profile: OAuthProfile;
    accessToken: string;
    next: string | null;
    ipHash: string;
    requestId: string;
    audit: import('@/contracts/audit').AuditSink;
  },
): Promise<SocialSignInResult> {
  const started = performance.now();
  const redirectSuccess = guestSignInLandingPath(input.next, '/guests');
  const profileName: ProviderProfileName = { givenName: input.profile.givenName, familyName: input.profile.familyName, name: input.profile.name };

  const finishPending = async (reason: SocialReviewReason, candidateGuestIds: string[]) => {
    await enqueueSocialReview(db, {
      provider: input.provider,
      profile: profileName,
      providerAccountId: input.profile.providerAccountId,
      reason,
      candidateGuestIds,
      ipHash: input.ipHash,
    });
    await hold(started);
    return { ok: false as const, redirectTo: PENDING_PATH };
  };

  const linked = await findLinkedAccount(db, input.provider, input.profile.providerAccountId);
  if (linked) {
    const user = (await db.select({ id: authUsers.id, email: authUsers.email }).from(authUsers).where(eq(authUsers.id, linked.userId)).limit(1))[0];
    if (user && !isSyntheticSocialEmail(user.email) && (await adminRolesForEmail(db, user.email)).size > 0) {
      const redirectTo = safeReturnPath(input.next, '/admin');
      return establishSocialSession(db, sink, { userId: user.id, activeGuestId: null, redirectTo, started });
    }
    const ownBindings = await activeBindingsForIdentity(db, linked.userId);
    const activeGuestId = ownBindings.find((b) => b.role === 'self')?.guestId ?? ownBindings[0]?.guestId ?? null;
    const auth = await getAuth(db);
    await establishGuestSession(db, auth, sink, { userId: linked.userId, activeGuestId });
    await hold(started);
    return { ok: true, redirectTo: redirectSuccess };
  }

  const verifiedEmail = verifiedProviderEmail(input.profile);
  if (verifiedEmail) {
    const roles = await adminRolesForEmail(db, verifiedEmail);
    if (roles.size > 0) {
      const adminResult = await completeAdminSocialSignIn(db, sink, {
        provider: input.provider,
        profile: input.profile,
        accessToken: input.accessToken,
        adminEmail: verifiedEmail,
        next: input.next,
        started,
      });
      if (adminResult) return adminResult;
    }
  }

  const candidates = (await listMatchableGuests(db)).filter((g) => g.kind !== 'child' && !g.isMinor);
  const { confidence, matches } = matchGuestsByName(profileName, candidates);

  if (confidence === 'none') return finishPending('no_match', []);
  if (confidence === 'ambiguous') return finishPending('ambiguous', matches.map((m) => m.id));

  const guest = matches[0]!;
  if (!(await invitationSentForGuest(db, guest.id))) return finishPending('not_sent', [guest.id]);

  const existingBinding = await activeBindingForGuest(db, guest.id);
  if (existingBinding) return finishPending('blocked', [guest.id]);

  const displayName = [input.profile.givenName, input.profile.familyName].filter(Boolean).join(' ') || input.profile.name || 'Guest';
  const email = syntheticSocialEmail(input.provider, input.profile.providerAccountId);
  const userResult = await ensureAuthUser(db, email, displayName);
  if (!userResult.ok) return finishPending('blocked', [guest.id]);
  await linkProviderAccount(db, { userId: userResult.value.id, provider: input.provider, accountId: input.profile.providerAccountId, accessToken: input.accessToken });

  const bound = await bindIdentity(db, {
    authIdentityId: userResult.value.id,
    guestId: guest.id,
    role: 'self',
    claimMethod: 'social',
    invitationId: null,
    actor: { kind: 'system', component: 'social_sign_in' },
    requestId: input.requestId,
    audit: input.audit,
  });
  if (!bound.ok) return finishPending('blocked', [guest.id]);

  const auth = await getAuth(db);
  await establishGuestSession(db, auth, sink, { userId: userResult.value.id, activeGuestId: guest.id });
  await hold(started);
  return { ok: true, redirectTo: redirectSuccess };
}

/** Minimum response time so match / non-match paths are harder to distinguish. */
async function hold(startedMs: number, floorMs = 150): Promise<void> {
  const remaining = floorMs - (performance.now() - startedMs);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}

export async function adminLinkSocialReview(
  db: Db,
  input: { reviewId: string; guestId: string; actor: import('@/contracts/principal').PrincipalRef; requestId: string; audit: import('@/contracts/audit').AuditSink },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const review = (await db.select().from(socialAuthReviews).where(eq(socialAuthReviews.id, input.reviewId)).limit(1))[0];
  if (!review || review.status !== 'open') return { ok: false, message: 'That review is no longer open.' };
  const guest = (await db.select().from(guests).where(eq(guests.id, input.guestId)).limit(1))[0];
  if (!guest || guest.mergedIntoGuestId) return { ok: false, message: 'Guest not found.' };

  const email = syntheticSocialEmail(review.providerId, review.providerAccountId);
  let user = await findAuthUserByEmail(db, email);
  if (!user) {
    const created = await ensureAuthUser(db, email, review.profileName.name ?? 'Guest');
    if (!created.ok) return { ok: false, message: created.error.message };
    user = created.value;
  }
  await linkProviderAccount(db, { userId: user.id, provider: review.providerId, accountId: review.providerAccountId });
  const bound = await bindIdentity(db, {
    authIdentityId: user.id,
    guestId: guest.id,
    role: 'self',
    claimMethod: 'social',
    invitationId: null,
    actor: input.actor,
    requestId: input.requestId,
    audit: input.audit,
  });
  if (!bound.ok) return { ok: false, message: bound.error.message };

  const now = new Date();
  await db
    .update(socialAuthReviews)
    .set({ status: 'linked', linkedGuestId: guest.id, linkedAuthIdentityId: user.id, resolvedAt: now, resolvedBy: input.actor })
    .where(eq(socialAuthReviews.id, review.id));
  return { ok: true };
}

export function hashSocialAttemptIp(ip: string): string {
  return hashOtpIdentifier(ip);
}

export function parseSocialNext(raw: string | null | undefined): string | null {
  return isSafeReturnPath(raw) ? raw : null;
}
