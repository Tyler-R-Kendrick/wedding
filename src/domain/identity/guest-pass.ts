import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guestSignInPasses, type GuestSignInPassRow } from '@/db/schema';
import { getGuest, guestDisplayName, listHouseholdMembers } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { activeBindingForGuest, getAuthUser } from '@/domain/identity/bindings';
import { randomNumericCode, randomToken, timingSafeEqualString } from '@/lib/crypto';
import { siteOrigin } from '@/lib/auth';
import { getGuestPassVault } from './guest-pass-vault';

export const GUEST_PASS_SLUG_BYTES = 12;
export const GUEST_PASS_SLUG_PATTERN = /^[A-Za-z0-9_-]{12,24}$/;
export const DEFAULT_GUEST_PASS_TTL_DAYS = 30;
export const GUEST_PASS_MAX_FAILED_ATTEMPTS = 5;

export type GuestPassLifecycle = 'active' | 'expired' | 'revoked';

export function guestPassLifecycle(row: Pick<GuestSignInPassRow, 'expiresAt' | 'revokedAt'>, now: Date = new Date()): GuestPassLifecycle {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function defaultGuestPassExpiry(now: Date = new Date(), ttlDays = DEFAULT_GUEST_PASS_TTL_DAYS): Date {
  return new Date(now.getTime() + ttlDays * 86_400_000);
}

export function guestPassUrl(siteUrl: string, slug: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return `${base}/s/${slug}`;
}

export function isGuestPassSlugShape(value: unknown): value is string {
  return typeof value === 'string' && GUEST_PASS_SLUG_PATTERN.test(value);
}

export interface IssueGuestPassInput {
  guestId: string;
  expiresAt?: Date;
  ttlDays?: number;
  issuedBy: PrincipalRef;
  requestId: string;
  audit: AuditSink;
  now?: Date;
}

export interface IssuedGuestPass {
  pass: GuestSignInPassRow;
  /** Shown once to admins; never stored in plaintext outside the seal. */
  code: string;
  url: string;
}

export async function issueGuestSignInPass(db: Db, input: IssueGuestPassInput): Promise<Result<IssuedGuestPass, CapabilityError>> {
  const now = input.now ?? new Date();
  const guest = await getGuest(db, input.guestId);
  if (!guest || guest.mergedIntoGuestId) return err(new CapabilityError('not_found', 'That guest could not be found.'));
  if (guest.kind === 'child' || guest.isMinor) return err(new CapabilityError('validation', 'Minors cannot sign in. Issue a pass for the adult who answers for them.'));
  const vault = await getGuestPassVault();
  const code = randomNumericCode(6);
  const slug = randomToken(GUEST_PASS_SLUG_BYTES);
  const expiresAt = input.expiresAt ?? defaultGuestPassExpiry(now, input.ttlDays ?? DEFAULT_GUEST_PASS_TTL_DAYS);
  const [row] = await db
    .insert(guestSignInPasses)
    .values({
      id: newId(),
      slug,
      guestId: guest.id,
      codeCiphertext: vault.seal(code),
      codeKeyId: vault.keyId,
      codeHash: vault.fingerprint(code),
      expiresAt,
      issuedBy: input.issuedBy,
      createdAt: now,
    })
    .returning();
  await input.audit.record({
    actor: input.issuedBy,
    action: 'identity.pass_issued',
    target: { type: 'guest', id: guest.id },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { passId: row!.id, expiresAt: expiresAt.toISOString() },
  });
  return ok({ pass: row!, code, url: guestPassUrl(siteOrigin(), slug) });
}

export async function findGuestPassBySlug(db: Db, slug: string): Promise<GuestSignInPassRow | null> {
  const rows = await db.select().from(guestSignInPasses).where(eq(guestSignInPasses.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function listGuestPassesForGuest(db: Db, guestId: string, limit = 20): Promise<GuestSignInPassRow[]> {
  return db.select().from(guestSignInPasses).where(eq(guestSignInPasses.guestId, guestId)).orderBy(desc(guestSignInPasses.createdAt)).limit(limit);
}

export async function revokeGuestSignInPass(
  db: Db,
  input: { passId: string; revokedBy: PrincipalRef; requestId: string; audit: AuditSink; now?: Date },
): Promise<Result<GuestSignInPassRow, CapabilityError>> {
  const now = input.now ?? new Date();
  const existing = await db.select().from(guestSignInPasses).where(eq(guestSignInPasses.id, input.passId)).limit(1);
  const pass = existing[0];
  if (!pass) return err(new CapabilityError('not_found', 'That sign-in link could not be found.'));
  if (pass.revokedAt) return ok(pass);
  const [row] = await db.update(guestSignInPasses).set({ revokedAt: now, revokedBy: input.revokedBy }).where(eq(guestSignInPasses.id, input.passId)).returning();
  await input.audit.record({
    actor: input.revokedBy,
    action: 'identity.pass_revoked',
    target: { type: 'guest', id: pass.guestId },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { passId: pass.id },
  });
  return ok(row!);
}

export interface ResolvedGuestPassPage {
  lifecycle: GuestPassLifecycle;
  guestDisplayName: string;
  /** Plain code for prefilling the POST form (server-rendered only). */
  code: string | null;
  slug: string;
}

/** Loads a pass for the GET `/s/[slug]` page. Does not verify or consume. */
export async function resolveGuestPassPage(db: Db, slug: string, now: Date = new Date()): Promise<ResolvedGuestPassPage | null> {
  const pass = await findGuestPassBySlug(db, slug);
  if (!pass) return null;
  const guest = await getGuest(db, pass.guestId);
  if (!guest) return null;
  const lifecycle = guestPassLifecycle(pass, now);
  if (lifecycle !== 'active') {
    return { lifecycle, guestDisplayName: guestDisplayName(guest), code: null, slug };
  }
  const vault = await getGuestPassVault();
  const opened = vault.unseal(pass.codeCiphertext);
  if (!opened.ok) return { lifecycle: 'expired', guestDisplayName: guestDisplayName(guest), code: null, slug };
  return { lifecycle, guestDisplayName: guestDisplayName(guest), code: opened.value, slug };
}

export interface GuestPassSignInTarget {
  email: string;
  /** Guest ids to ensure bindings for (sign-in flow). */
  guestIds: string[];
  managedGuestIds: string[];
  activeGuestId: string;
  invitationId: string | null;
}

/**
 * Resolves which inbox and guest binding a pass signs in as — same rules as claim/sign-in OTP.
 */
export async function resolveGuestPassSignInTarget(db: Db, guestId: string): Promise<Result<GuestPassSignInTarget, CapabilityError>> {
  const guest = await getGuest(db, guestId);
  if (!guest || guest.mergedIntoGuestId) return err(new CapabilityError('not_found', 'That guest could not be found.'));
  if (guest.kind === 'child' || guest.isMinor) return err(new CapabilityError('validation', 'This pass cannot sign in a minor.'));
  const household = await getHousehold(db, guest.householdId);
  const members = household ? await listHouseholdMembers(db, household.id) : [];
  const boundTo = await activeBindingForGuest(db, guest.id);
  let email: string | null = null;
  let bindGuestId = guest.id;
  const managed: string[] = [];
  if (boundTo) email = (await getAuthUser(db, boundTo.authIdentityId))?.email ?? null;
  else if (guest.email) email = guest.email;
  else {
    const managerId = guest.managedByGuestId ?? household?.managerGuestId ?? null;
    const manager = members.find((m) => m.id === managerId && m.kind !== 'child' && !m.isMinor) ?? members.find((m) => m.kind !== 'child' && !m.isMinor && !!m.email) ?? null;
    if (manager) {
      const managerBinding = await activeBindingForGuest(db, manager.id);
      email = managerBinding ? ((await getAuthUser(db, managerBinding.authIdentityId))?.email ?? null) : manager.email;
      bindGuestId = manager.id;
      if (guest.id !== manager.id) managed.push(guest.id);
    }
  }
  if (!email) return err(new CapabilityError('validation', 'There is no email on file for this guest yet. Ask Sara and Tyler to add one, or use email sign-in after they do.'));
  return ok({
    email,
    guestIds: [bindGuestId],
    managedGuestIds: managed,
    activeGuestId: guest.id,
    invitationId: null,
  });
}

export async function verifyGuestPassCode(db: Db, pass: GuestSignInPassRow, code: string, vault?: Awaited<ReturnType<typeof getGuestPassVault>>): Promise<boolean> {
  const v = vault ?? (await getGuestPassVault());
  const fingerprint = v.fingerprint(code.replace(/\s+/g, ''));
  return timingSafeEqualString(fingerprint, pass.codeHash);
}

export async function recordGuestPassFailure(db: Db, passId: string): Promise<number> {
  const existing = await db.select({ failedAttempts: guestSignInPasses.failedAttempts }).from(guestSignInPasses).where(eq(guestSignInPasses.id, passId)).limit(1);
  const current = existing[0]?.failedAttempts ?? 0;
  const next = current + 1;
  await db.update(guestSignInPasses).set({ failedAttempts: next }).where(eq(guestSignInPasses.id, passId));
  return next;
}

export async function activePassesForGuest(db: Db, guestId: string, now: Date = new Date()): Promise<GuestSignInPassRow[]> {
  return db
    .select()
    .from(guestSignInPasses)
    .where(and(eq(guestSignInPasses.guestId, guestId), isNull(guestSignInPasses.revokedAt), gt(guestSignInPasses.expiresAt, now)));
}
