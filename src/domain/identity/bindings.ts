import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { authSessions, authUsers, guestAccessBindings, guests, type AuthUserRow, type BindingRole, type ClaimMethod, type GuestAccessBindingRow } from '@/db/schema';
import { scrubForAudit } from './audit';
import { isEmailShape, normalizeEmail } from './mask';

/**
 * GuestAccessBinding operations (ADR-0001). Invariants:
 *  - at most one active binding per guest (a guest belongs to one verified inbox)
 *  - an identity may hold several bindings (shared inbox, delegate, manager)
 *  - revoking a binding ends every session of that identity (rule 6)
 *  - every change writes an audit row
 */
export const activeBindingWhere = () => isNull(guestAccessBindings.revokedAt);

/** Postgres unique-violation (23505) as raised by postgres-js or PGlite (nested `cause`, or message text). */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 4; depth++) {
    const anyErr = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (anyErr.code === '23505') return true;
    if (typeof anyErr.message === 'string' && /duplicate key value|unique constraint|guest_access_bindings_one_active/i.test(anyErr.message)) return true;
    cur = anyErr.cause;
  }
  return false;
}

export async function activeBindingsForIdentity(db: Db, authIdentityId: string): Promise<GuestAccessBindingRow[]> {
  return db.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.authIdentityId, authIdentityId), activeBindingWhere()));
}

export async function activeBindingForGuest(db: Db, guestId: string): Promise<GuestAccessBindingRow | null> {
  const rows = await db.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, guestId), activeBindingWhere())).limit(1);
  return rows[0] ?? null;
}

export async function activeBindingsForGuests(db: Db, guestIds: readonly string[]): Promise<Map<string, GuestAccessBindingRow>> {
  const out = new Map<string, GuestAccessBindingRow>();
  if (guestIds.length === 0) return out;
  const rows = await db.select().from(guestAccessBindings).where(and(inArray(guestAccessBindings.guestId, [...guestIds]), activeBindingWhere()));
  for (const r of rows) out.set(r.guestId, r);
  return out;
}

export async function findAuthUserByEmail(db: Db, email: string): Promise<AuthUserRow | null> {
  const normalized = normalizeEmail(email);
  const rows = await db.select().from(authUsers).where(eq(authUsers.email, normalized)).limit(1);
  return rows[0] ?? null;
}

export async function getAuthUser(db: Db, id: string): Promise<AuthUserRow | null> {
  const rows = await db.select().from(authUsers).where(eq(authUsers.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Finds or creates the Better Auth user for an email (unverified until they complete an OTP). */
export async function ensureAuthUser(db: Db, email: string, name = ''): Promise<Result<AuthUserRow, CapabilityError>> {
  const normalized = normalizeEmail(email);
  if (!isEmailShape(normalized)) return err(new CapabilityError('validation', 'That email address does not look right.'));
  const existing = await findAuthUserByEmail(db, normalized);
  if (existing) return ok(existing);
  const now = new Date();
  const [row] = await db.insert(authUsers).values({ id: newId(), email: normalized, name, emailVerified: false, createdAt: now, updatedAt: now }).returning();
  return ok(row!);
}

/** Ends every session of an identity (revocation, reset, rebind, admin sign-out). */
export async function revokeSessionsForIdentity(db: Db, authIdentityId: string, input?: { actor: PrincipalRef; requestId: string; audit: AuditSink; reason: string }): Promise<number> {
  const deleted = await db.delete(authSessions).where(eq(authSessions.userId, authIdentityId)).returning({ id: authSessions.id });
  if (input && deleted.length) {
    await input.audit.record({
      actor: input.actor,
      action: 'session.revoked',
      target: { type: 'auth_identity', id: authIdentityId },
      outcome: 'success',
      requestId: input.requestId,
      metadata: { count: deleted.length, reason: scrubForAudit(input.reason) },
    });
  }
  return deleted.length;
}

export interface BindInput {
  authIdentityId: string;
  guestId: string;
  role: BindingRole;
  claimMethod: ClaimMethod;
  invitationId?: string | null;
  actor: PrincipalRef;
  requestId: string;
  audit: AuditSink;
  now?: Date;
}

/**
 * Binds an identity to a guest. Idempotent for the same identity; refuses when another
 * identity already holds the guest (forwarded links cannot take over a bound identity —
 * the second claimer must prove the bound inbox or ask an admin to rebind).
 */
export async function bindIdentity(db: Db, input: BindInput): Promise<Result<GuestAccessBindingRow, CapabilityError>> {
  const guest = (await db.select().from(guests).where(eq(guests.id, input.guestId)).limit(1))[0];
  if (!guest || guest.mergedIntoGuestId) return err(new CapabilityError('not_found', 'We could not find that guest.'));
  if (guest.kind === 'child' || guest.isMinor) return err(new CapabilityError('forbidden', 'Children are included through their household, and do not sign in themselves.'));
  const existing = await activeBindingForGuest(db, input.guestId);
  if (existing) {
    if (existing.authIdentityId === input.authIdentityId) return ok(existing);
    await input.audit.record({
      actor: input.actor,
      action: 'identity.bound',
      target: { type: 'guest', id: input.guestId },
      outcome: 'denied',
      requestId: input.requestId,
      metadata: { reason: 'already_bound', role: input.role, claimMethod: input.claimMethod },
    });
    return err(new CapabilityError('conflict', 'This invitation has already been claimed. If that was not you, please get in touch with Sara and Tyler.'));
  }
  let row: GuestAccessBindingRow | undefined;
  try {
    [row] = await db
      .insert(guestAccessBindings)
      .values({
        id: newId(),
        authIdentityId: input.authIdentityId,
        guestId: input.guestId,
        role: input.role,
        claimMethod: input.claimMethod,
        invitationId: input.invitationId ?? null,
        claimedAt: input.now ?? new Date(),
      })
      .returning();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost the race against a concurrent claim: the partial unique index guarantees one active binding.
    await input.audit.record({
      actor: input.actor,
      action: 'identity.bound',
      target: { type: 'guest', id: input.guestId },
      outcome: 'denied',
      requestId: input.requestId,
      metadata: { reason: 'already_bound_concurrent', role: input.role, claimMethod: input.claimMethod },
    });
    return err(new CapabilityError('conflict', 'This invitation has already been claimed. If that was not you, please get in touch with Sara and Tyler.'));
  }
  await input.audit.record({
    actor: input.actor,
    action: 'identity.bound',
    target: { type: 'guest', id: input.guestId },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { bindingId: row!.id, role: input.role, claimMethod: input.claimMethod, invitationId: input.invitationId ?? null },
  });
  return ok(row!);
}

/** Admin or guest: revoke every active binding for a guest and end the sessions behind them. */
export async function resetIdentity(
  db: Db,
  input: { guestId: string; reason: string; actor: PrincipalRef; requestId: string; audit: AuditSink; now?: Date },
): Promise<Result<{ revoked: number; sessionsEnded: number }, CapabilityError>> {
  const now = input.now ?? new Date();
  const active = await db.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, input.guestId), activeBindingWhere()));
  let sessionsEnded = 0;
  if (active.length) {
    await db
      .update(guestAccessBindings)
      .set({ revokedAt: now, revokedBy: input.actor, revokedReason: input.reason })
      .where(inArray(guestAccessBindings.id, active.map((b) => b.id)));
    for (const identity of new Set(active.map((b) => b.authIdentityId))) sessionsEnded += await revokeSessionsForIdentity(db, identity, { actor: input.actor, requestId: input.requestId, audit: input.audit, reason: `identity reset: ${input.reason}` });
  }
  await input.audit.record({
    actor: input.actor,
    action: 'identity.reset',
    target: { type: 'guest', id: input.guestId },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { revoked: active.length, sessionsEnded, reason: scrubForAudit(input.reason) },
  });
  return ok({ revoked: active.length, sessionsEnded });
}

/**
 * Admin-assisted rebind: move a guest to a (possibly new) identity by verified-later email.
 * The previous binding is revoked and linked from the new one; both steps are audited.
 */
export async function rebindIdentity(
  db: Db,
  input: { guestId: string; email: string; reason: string; actor: PrincipalRef; requestId: string; audit: AuditSink; now?: Date },
): Promise<Result<GuestAccessBindingRow, CapabilityError>> {
  const now = input.now ?? new Date();
  const guest = (await db.select().from(guests).where(eq(guests.id, input.guestId)).limit(1))[0];
  if (!guest || guest.mergedIntoGuestId) return err(new CapabilityError('not_found', 'That guest does not exist.'));
  if (guest.kind === 'child' || guest.isMinor) return err(new CapabilityError('validation', 'Children do not have their own access.'));
  const user = await ensureAuthUser(db, input.email, [guest.firstName, guest.lastName].filter(Boolean).join(' '));
  if (!user.ok) return err(user.error);
  const previous = await activeBindingForGuest(db, input.guestId);
  if (previous && previous.authIdentityId === user.value.id) return ok(previous);
  if (previous) {
    await db.update(guestAccessBindings).set({ revokedAt: now, revokedBy: input.actor, revokedReason: `rebound: ${input.reason}` }).where(eq(guestAccessBindings.id, previous.id));
    await revokeSessionsForIdentity(db, previous.authIdentityId, { actor: input.actor, requestId: input.requestId, audit: input.audit, reason: `rebound: ${input.reason}` });
  }
  const [row] = await db
    .insert(guestAccessBindings)
    .values({ id: newId(), authIdentityId: user.value.id, guestId: input.guestId, role: 'self', claimMethod: 'admin', claimedAt: now, reboundFromId: previous?.id ?? null })
    .returning();
  await db.update(guests).set({ email: user.value.email, updatedAt: now }).where(eq(guests.id, input.guestId));
  await input.audit.record({
    actor: input.actor,
    action: 'identity.rebound',
    target: { type: 'guest', id: input.guestId },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { bindingId: row!.id, previousBindingId: previous?.id ?? null, reason: scrubForAudit(input.reason) },
  });
  return ok(row!);
}
