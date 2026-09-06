import { and, asc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId, type GuestId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { GUEST_KINDS, guestAccessBindings, guests, households, type GuestKind, type GuestRow } from '@/db/schema';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';

export interface GuestUpsert {
  id?: string;
  householdId: string;
  firstName: string;
  lastName?: string;
  email?: string | null;
  kind?: GuestKind;
  isMinor?: boolean;
  isNamed?: boolean;
  plusOneOfGuestId?: string | null;
  managedByGuestId?: string | null;
  notes?: string | null;
}

const notMerged = isNull(guests.mergedIntoGuestId);

export async function getGuest(db: Db, id: string): Promise<GuestRow | null> {
  const rows = await db.select().from(guests).where(eq(guests.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getGuestsByIds(db: Db, ids: readonly string[]): Promise<GuestRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(guests).where(inArray(guests.id, [...ids]));
}

/** Members of a household as printed (merged duplicates hidden), children last, alphabetical. */
export async function listHouseholdMembers(db: Db, householdId: string): Promise<GuestRow[]> {
  const rows = await db.select().from(guests).where(and(eq(guests.householdId, householdId), notMerged)).orderBy(asc(guests.firstName), asc(guests.lastName));
  return rows.sort((a, b) => Number(a.kind === 'child' || a.isMinor) - Number(b.kind === 'child' || b.isMinor));
}

/** Every live guest that lists this address (shared inboxes return several). */
export async function findGuestsByEmail(db: Db, email: string): Promise<GuestRow[]> {
  const normalized = normalizeEmail(email);
  if (!isEmailShape(normalized)) return [];
  return db.select().from(guests).where(and(eq(guests.email, normalized), notMerged)).orderBy(asc(guests.createdAt));
}

/** Guests managed by any of `managerIds`: household manager role or an explicit managedBy. */
export async function listManagedGuests(db: Db, managerIds: readonly string[]): Promise<GuestRow[]> {
  if (managerIds.length === 0) return [];
  const managedHouseholds = await db.select({ id: households.id }).from(households).where(inArray(households.managerGuestId, [...managerIds]));
  const householdIds = managedHouseholds.map((h) => h.id);
  const clauses = [inArray(guests.managedByGuestId, [...managerIds])];
  if (householdIds.length) clauses.push(inArray(guests.householdId, householdIds));
  const rows = await db.select().from(guests).where(and(or(...clauses), notMerged));
  return rows.filter((g) => !managerIds.includes(g.id));
}

export async function listGuests(db: Db, filter: { householdId?: string; q?: string; includeMerged?: boolean; limit?: number; offset?: number } = {}): Promise<GuestRow[]> {
  const conditions = [
    filter.householdId ? eq(guests.householdId, filter.householdId) : undefined,
    filter.includeMerged ? undefined : notMerged,
    filter.q
      ? or(ilike(guests.firstName, `%${filter.q.replace(/[%_]/g, '')}%`), ilike(guests.lastName, `%${filter.q.replace(/[%_]/g, '')}%`), ilike(guests.email, `%${filter.q.replace(/[%_]/g, '')}%`))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);
  return db
    .select()
    .from(guests)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(guests.lastName), asc(guests.firstName))
    .limit(Math.min(filter.limit ?? 500, 2000))
    .offset(filter.offset ?? 0);
}

export async function upsertGuest(db: Db, input: GuestUpsert): Promise<Result<GuestRow, CapabilityError>> {
  const firstName = input.firstName.trim();
  if (!firstName) return err(new CapabilityError('validation', 'A guest needs a first name.'));
  const kind: GuestKind = input.kind ?? 'adult';
  if (!GUEST_KINDS.includes(kind)) return err(new CapabilityError('validation', 'Unknown guest kind.'));
  let email: string | null = null;
  if (input.email) {
    email = normalizeEmail(input.email);
    if (!isEmailShape(email)) return err(new CapabilityError('validation', 'That email address does not look right.', { issues: [{ path: 'email', message: 'Enter a valid email address.' }] }));
  }
  const household = (await db.select({ id: households.id }).from(households).where(eq(households.id, input.householdId)).limit(1))[0];
  if (!household) return err(new CapabilityError('not_found', 'That household does not exist.'));
  if (input.id) {
    // Review N3: an edit changes only the fields it carries; absent fields keep their stored value.
    const patch: Partial<typeof guests.$inferInsert> = { householdId: input.householdId, firstName, updatedAt: new Date() };
    if (input.lastName !== undefined) patch.lastName = input.lastName.trim();
    if (input.email !== undefined) patch.email = email;
    if (input.kind !== undefined) patch.kind = kind;
    if (input.isMinor !== undefined) patch.isMinor = input.isMinor;
    else if (input.kind === 'child') patch.isMinor = true;
    if (input.isNamed !== undefined) patch.isNamed = input.isNamed;
    if (input.plusOneOfGuestId !== undefined) patch.plusOneOfGuestId = input.plusOneOfGuestId;
    if (input.managedByGuestId !== undefined) patch.managedByGuestId = input.managedByGuestId;
    if (input.notes !== undefined) patch.notes = input.notes;
    const [row] = await db.update(guests).set(patch).where(eq(guests.id, input.id)).returning();
    if (!row) return err(new CapabilityError('not_found', 'That guest does not exist.'));
    return ok(row);
  }
  const values = {
    householdId: input.householdId,
    firstName,
    lastName: (input.lastName ?? '').trim(),
    email,
    kind,
    isMinor: input.isMinor ?? kind === 'child',
    isNamed: input.isNamed ?? true,
    plusOneOfGuestId: input.plusOneOfGuestId ?? null,
    managedByGuestId: input.managedByGuestId ?? null,
    notes: input.notes ?? null,
    updatedAt: new Date(),
  };
  const [row] = await db.insert(guests).values({ id: newId<GuestId>(), ...values, createdAt: new Date() }).returning();
  return ok(row!);
}

export async function deleteGuest(db: Db, id: string): Promise<Result<void, CapabilityError>> {
  const bound = await db.select({ id: guestAccessBindings.id }).from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, id), isNull(guestAccessBindings.revokedAt))).limit(1);
  if (bound.length) return err(new CapabilityError('conflict', 'Reset this guest’s access before deleting them.'));
  const managing = await db.select({ id: households.id }).from(households).where(eq(households.managerGuestId, id)).limit(1);
  if (managing.length) return err(new CapabilityError('conflict', 'Pick another household manager before deleting this guest.'));
  await db.delete(guests).where(eq(guests.id, id));
  return ok(undefined);
}

/**
 * Duplicate merge (admin). The kept guest wins on every field except empty ones; the merged
 * guest's active binding moves over when the kept guest has none, otherwise it is revoked.
 * Merged rows stay for the audit trail but are inert everywhere (`mergedIntoGuestId`).
 */
export async function mergeGuests(
  db: Db,
  input: { keepId: string; mergeId: string; actor: PrincipalRef; requestId: string; audit: AuditSink },
): Promise<Result<GuestRow, CapabilityError>> {
  if (input.keepId === input.mergeId) return err(new CapabilityError('validation', 'Pick two different guests.'));
  const [keep, merge] = await Promise.all([getGuest(db, input.keepId), getGuest(db, input.mergeId)]);
  if (!keep || !merge) return err(new CapabilityError('not_found', 'One of those guests does not exist.'));
  if (keep.mergedIntoGuestId || merge.mergedIntoGuestId) return err(new CapabilityError('conflict', 'One of those guests was already merged.'));
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [kept] = await tx
      .update(guests)
      .set({ email: keep.email ?? merge.email, lastName: keep.lastName || merge.lastName, notes: keep.notes ?? merge.notes, updatedAt: now })
      .where(eq(guests.id, keep.id))
      .returning();
    const keepBinding = (await tx.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, keep.id), isNull(guestAccessBindings.revokedAt))).limit(1))[0];
    const mergeBindings = await tx.select().from(guestAccessBindings).where(and(eq(guestAccessBindings.guestId, merge.id), isNull(guestAccessBindings.revokedAt)));
    for (const b of mergeBindings) {
      if (!keepBinding) {
        await tx.update(guestAccessBindings).set({ guestId: keep.id }).where(eq(guestAccessBindings.id, b.id));
      } else {
        await tx.update(guestAccessBindings).set({ revokedAt: now, revokedBy: input.actor, revokedReason: `merged into ${keep.id}` }).where(eq(guestAccessBindings.id, b.id));
      }
    }
    await tx.update(guests).set({ managedByGuestId: keep.id, updatedAt: now }).where(eq(guests.managedByGuestId, merge.id));
    await tx.update(guests).set({ plusOneOfGuestId: keep.id, updatedAt: now }).where(eq(guests.plusOneOfGuestId, merge.id));
    await tx.update(households).set({ managerGuestId: keep.id, updatedAt: now }).where(eq(households.managerGuestId, merge.id));
    await tx.update(guests).set({ mergedIntoGuestId: keep.id, email: null, updatedAt: now }).where(eq(guests.id, merge.id));
    return kept!;
  });
  await input.audit.record({
    actor: input.actor,
    action: 'guest.merged',
    target: { type: 'guest', id: keep.id },
    outcome: 'success',
    requestId: input.requestId,
    metadata: { mergedGuestId: merge.id },
  });
  return ok(result);
}

export const guestDisplayName = (g: Pick<GuestRow, 'firstName' | 'lastName' | 'isNamed' | 'kind'>): string =>
  g.isNamed ? [g.firstName, g.lastName].filter(Boolean).join(' ') : g.kind === 'plus_one' ? 'Guest' : g.firstName;
