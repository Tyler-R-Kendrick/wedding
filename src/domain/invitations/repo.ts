import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId, type InvitationId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { households, invitations, type InvitationRow, type InvitationStatus } from '@/db/schema';
import { defaultInvitationExpiry, generateInvitationToken, hashInvitationToken, invitationTokenPrefix, isInvitationTokenShape } from '@/domain/identity/tokens';

export interface IssueInvitationInput {
  householdId: string;
  eventKeys?: string[];
  plusOneAllowance?: number;
  childrenAllowance?: number;
  expiresAt?: Date;
  issuedBy: PrincipalRef;
  requestId: string;
  audit: AuditSink;
  rotatedFromId?: string;
  now?: Date;
}

/** Issues a new discovery token. The plain token is returned exactly once and never stored. */
export async function issueInvitation(db: Db, input: IssueInvitationInput): Promise<Result<{ invitation: InvitationRow; token: string }, CapabilityError>> {
  const household = (await db.select({ id: households.id }).from(households).where(eq(households.id, input.householdId)).limit(1))[0];
  if (!household) return err(new CapabilityError('not_found', 'That household does not exist.'));
  const now = input.now ?? new Date();
  const token = generateInvitationToken();
  const [row] = await db
    .insert(invitations)
    .values({
      id: newId<InvitationId>(),
      householdId: input.householdId,
      tokenHash: hashInvitationToken(token),
      tokenPrefix: invitationTokenPrefix(token),
      status: 'issued',
      eventKeys: input.eventKeys ?? [],
      plusOneAllowance: input.plusOneAllowance ?? 0,
      childrenAllowance: input.childrenAllowance ?? 0,
      issuedAt: now,
      expiresAt: input.expiresAt ?? defaultInvitationExpiry(now),
      rotatedFromId: input.rotatedFromId ?? null,
      issuedBy: input.issuedBy,
    })
    .returning();
  await input.audit.record({
    actor: input.issuedBy,
    action: 'invitation.issued',
    target: { type: 'invitation', id: row!.id },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { householdId: input.householdId, rotatedFromId: input.rotatedFromId ?? null, eventCount: (input.eventKeys ?? []).length },
  });
  return ok({ invitation: row!, token });
}

export async function getInvitation(db: Db, id: string): Promise<InvitationRow | null> {
  const rows = await db.select().from(invitations).where(eq(invitations.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Constant-shape lookup: malformed tokens are treated exactly like unknown ones. */
export async function findInvitationByToken(db: Db, token: unknown): Promise<InvitationRow | null> {
  if (!isInvitationTokenShape(token)) return null;
  const rows = await db.select().from(invitations).where(eq(invitations.tokenHash, hashInvitationToken(token))).limit(1);
  return rows[0] ?? null;
}

/** The household's live invitation (latest not revoked), if any. */
export async function currentInvitationForHousehold(db: Db, householdId: string): Promise<InvitationRow | null> {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.householdId, householdId), ne(invitations.status, 'revoked')))
    .orderBy(desc(invitations.issuedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function currentInvitationsForHouseholds(db: Db, householdIds: readonly string[]): Promise<Map<string, InvitationRow>> {
  const out = new Map<string, InvitationRow>();
  if (householdIds.length === 0) return out;
  const rows = await db
    .select()
    .from(invitations)
    .where(and(inArray(invitations.householdId, [...householdIds]), ne(invitations.status, 'revoked')))
    .orderBy(desc(invitations.issuedAt));
  for (const r of rows) if (!out.has(r.householdId)) out.set(r.householdId, r);
  return out;
}

export async function listInvitations(db: Db, filter: { householdId?: string; status?: InvitationStatus; limit?: number; offset?: number } = {}): Promise<InvitationRow[]> {
  const conditions = [filter.householdId ? eq(invitations.householdId, filter.householdId) : undefined, filter.status ? eq(invitations.status, filter.status) : undefined].filter(
    (c): c is NonNullable<typeof c> => c !== undefined,
  );
  return db
    .select()
    .from(invitations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invitations.issuedAt))
    .limit(Math.min(filter.limit ?? 500, 2000))
    .offset(filter.offset ?? 0);
}

export async function markInvitationClaimed(db: Db, id: string, now: Date = new Date()): Promise<void> {
  await db.update(invitations).set({ status: 'claimed', claimedAt: now }).where(and(eq(invitations.id, id), eq(invitations.status, 'issued')));
}

export async function revokeInvitation(
  db: Db,
  input: { invitationId: string; reason: string; actor: PrincipalRef; requestId: string; audit: AuditSink; now?: Date; action?: 'invitation.revoked' | 'invitation.rotated' },
): Promise<Result<InvitationRow, CapabilityError>> {
  const now = input.now ?? new Date();
  const [row] = await db
    .update(invitations)
    .set({ status: 'revoked', revokedAt: now, revokedReason: input.reason })
    .where(and(eq(invitations.id, input.invitationId), ne(invitations.status, 'revoked')))
    .returning();
  if (!row) return err(new CapabilityError('not_found', 'That invitation is not active.'));
  await input.audit.record({
    actor: input.actor,
    action: input.action ?? 'invitation.revoked',
    target: { type: 'invitation', id: row.id },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { householdId: row.householdId, reason: input.reason },
  });
  return ok(row);
}

/** Rotation: revoke the current token and issue a fresh one for the same household/scope. */
export async function rotateInvitation(
  db: Db,
  input: { invitationId: string; actor: PrincipalRef; requestId: string; audit: AuditSink; expiresAt?: Date; now?: Date },
): Promise<Result<{ invitation: InvitationRow; token: string }, CapabilityError>> {
  const old = await getInvitation(db, input.invitationId);
  if (!old) return err(new CapabilityError('not_found', 'That invitation does not exist.'));
  const revoked = await revokeInvitation(db, { invitationId: old.id, reason: 'rotated', actor: input.actor, requestId: input.requestId, audit: input.audit, now: input.now, action: 'invitation.rotated' });
  if (!revoked.ok && old.status !== 'revoked') return err(revoked.error);
  return issueInvitation(db, {
    householdId: old.householdId,
    eventKeys: old.eventKeys,
    plusOneAllowance: old.plusOneAllowance,
    childrenAllowance: old.childrenAllowance,
    expiresAt: input.expiresAt,
    issuedBy: input.actor,
    requestId: input.requestId,
    audit: input.audit,
    rotatedFromId: old.id,
    now: input.now,
  });
}
