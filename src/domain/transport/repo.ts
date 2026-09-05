import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { newId, type TransportationClaimId, type TransportationEntitlementId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import {
  transportationClaims,
  transportationEntitlements,
  transportationManualCodes,
  type ClaimStatus,
  type RedemptionKind,
  type TransportationClaimRow,
  type TransportationEntitlementRow,
  type TransportationManualCodeRow,
} from '@/db/schema';

export interface AssignEntitlementInput {
  guestId: string;
  householdId: string;
  program: string;
  providerProgramRef?: string;
  amountNote?: string;
  validityNote?: string;
  geofenceNote?: string;
  guestIsMinor?: boolean;
  validFrom?: Date;
  validUntil?: Date;
  sourceId?: string;
  verifiedAt?: Date;
  assignedBy: PrincipalRef;
}

/** Upsert on (guest, program): re-assigning updates the notes and re-activates a revoked row. */
export async function upsertEntitlement(db: Db, input: AssignEntitlementInput, now: Date = new Date()): Promise<TransportationEntitlementRow> {
  const values = {
    id: newId<TransportationEntitlementId>(),
    guestId: input.guestId,
    householdId: input.householdId,
    program: input.program,
    providerProgramRef: input.providerProgramRef ?? null,
    amountNote: input.amountNote ?? null,
    validityNote: input.validityNote ?? null,
    geofenceNote: input.geofenceNote ?? null,
    guestIsMinor: input.guestIsMinor ?? false,
    status: 'active' as const,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceId: input.sourceId ?? null,
    verifiedAt: input.verifiedAt ?? null,
    assignedBy: input.assignedBy,
    createdAt: now,
    updatedAt: now,
  };
  const { id: _id, createdAt: _c, ...update } = values;
  const [row] = await db
    .insert(transportationEntitlements)
    .values(values)
    .onConflictDoUpdate({ target: [transportationEntitlements.guestId, transportationEntitlements.program], set: update })
    .returning();
  return row!;
}

export async function getEntitlement(db: Db, id: string): Promise<TransportationEntitlementRow | null> {
  const rows = await db.select().from(transportationEntitlements).where(eq(transportationEntitlements.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listEntitlementsForGuest(db: Db, guestId: string): Promise<TransportationEntitlementRow[]> {
  return db.select().from(transportationEntitlements).where(eq(transportationEntitlements.guestId, guestId)).orderBy(asc(transportationEntitlements.program));
}

export async function listEntitlements(db: Db, filter: { householdId?: string; limit?: number } = {}): Promise<TransportationEntitlementRow[]> {
  return db
    .select()
    .from(transportationEntitlements)
    .where(filter.householdId ? eq(transportationEntitlements.householdId, filter.householdId) : undefined)
    .orderBy(desc(transportationEntitlements.createdAt))
    .limit(Math.min(filter.limit ?? 200, 1000));
}

export async function setEntitlementStatus(db: Db, id: string, status: 'active' | 'revoked', now: Date = new Date()): Promise<TransportationEntitlementRow | null> {
  const [row] = await db.update(transportationEntitlements).set({ status, updatedAt: now }).where(eq(transportationEntitlements.id, id)).returning();
  return row ?? null;
}

export async function getClaimForEntitlement(db: Db, entitlementId: string): Promise<TransportationClaimRow | null> {
  const rows = await db.select().from(transportationClaims).where(eq(transportationClaims.entitlementId, entitlementId)).limit(1);
  return rows[0] ?? null;
}

export async function getClaim(db: Db, id: string): Promise<TransportationClaimRow | null> {
  const rows = await db.select().from(transportationClaims).where(eq(transportationClaims.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Reserves the one claim slot for an entitlement. Returns the inserted row, or null when a
 * claim already exists (the unique index is the arbiter under concurrency).
 */
export async function insertPendingClaim(
  db: Db,
  input: { entitlementId: string; guestId: string; householdId: string; providerName: string; requestId: string },
  now: Date = new Date(),
): Promise<TransportationClaimRow | null> {
  const rows = await db
    .insert(transportationClaims)
    .values({
      id: newId<TransportationClaimId>(),
      entitlementId: input.entitlementId,
      guestId: input.guestId,
      householdId: input.householdId,
      status: 'pending',
      providerName: input.providerName,
      requestId: input.requestId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: transportationClaims.entitlementId })
    .returning();
  return rows[0] ?? null;
}

export async function markClaimPending(db: Db, id: string, providerName: string, requestId: string, now: Date = new Date()): Promise<void> {
  await db.update(transportationClaims).set({ status: 'pending', providerName, requestId, failureReason: null, updatedAt: now }).where(eq(transportationClaims.id, id));
}

export async function markClaimIssued(
  db: Db,
  id: string,
  input: { providerName: string; providerRef: string | null; redemptionKind: RedemptionKind; secretCiphertext: string | null; secretKeyId: string | null; expiresAt: Date | null },
  now: Date = new Date(),
): Promise<TransportationClaimRow | null> {
  const [row] = await db
    .update(transportationClaims)
    .set({ status: 'issued', ...input, claimedAt: now, updatedAt: now, failureReason: null })
    .where(eq(transportationClaims.id, id))
    .returning();
  return row ?? null;
}

export async function markClaimFailed(db: Db, id: string, reason: string, now: Date = new Date()): Promise<void> {
  await db.update(transportationClaims).set({ status: 'failed', failureReason: reason.slice(0, 200), updatedAt: now }).where(eq(transportationClaims.id, id));
}

export async function setClaimStatus(db: Db, id: string, status: ClaimStatus, now: Date = new Date()): Promise<void> {
  await db.update(transportationClaims).set({ status, updatedAt: now }).where(eq(transportationClaims.id, id));
}

export async function listClaims(db: Db, filter: { limit?: number } = {}): Promise<TransportationClaimRow[]> {
  return db.select().from(transportationClaims).orderBy(desc(transportationClaims.createdAt)).limit(Math.min(filter.limit ?? 200, 1000));
}

// ---- manual codes (sealed at rest) ----

export async function insertManualCode(
  db: Db,
  input: { program: string; codeCiphertext: string; codeKeyId: string; codeHash: string; uploadedBy: PrincipalRef },
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .insert(transportationManualCodes)
    .values({ id: newId(), program: input.program, codeCiphertext: input.codeCiphertext, codeKeyId: input.codeKeyId, codeHash: input.codeHash, status: 'available', uploadedBy: input.uploadedBy, uploadedAt: now })
    .onConflictDoNothing({ target: transportationManualCodes.codeHash })
    .returning({ id: transportationManualCodes.id });
  return rows.length > 0;
}

export async function getManualCodeForClaim(db: Db, claimId: string): Promise<TransportationManualCodeRow | null> {
  const rows = await db.select().from(transportationManualCodes).where(eq(transportationManualCodes.claimId, claimId)).limit(1);
  return rows[0] ?? null;
}

/** Atomically hands one available code of `program` to `claimId`. Null when the pool is empty. */
export async function takeManualCode(db: Db, program: string, claimId: string, now: Date = new Date()): Promise<TransportationManualCodeRow | null> {
  const rows = await db
    .update(transportationManualCodes)
    .set({ status: 'issued', claimId, issuedAt: now })
    .where(
      and(
        eq(transportationManualCodes.status, 'available'),
        eq(
          transportationManualCodes.id,
          sql`(SELECT id FROM ${transportationManualCodes} WHERE ${transportationManualCodes.program} = ${program} AND ${transportationManualCodes.status} = 'available' ORDER BY uploaded_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)`,
        ),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function countManualCodes(db: Db): Promise<{ program: string; available: number; issued: number }[]> {
  const rows = await db
    .select({ program: transportationManualCodes.program, status: transportationManualCodes.status, n: sql<number>`count(*)::int` })
    .from(transportationManualCodes)
    .groupBy(transportationManualCodes.program, transportationManualCodes.status);
  const out = new Map<string, { program: string; available: number; issued: number }>();
  for (const r of rows) {
    const entry = out.get(r.program) ?? { program: r.program, available: 0, issued: 0 };
    if (r.status === 'available') entry.available += Number(r.n);
    if (r.status === 'issued') entry.issued += Number(r.n);
    out.set(r.program, entry);
  }
  return [...out.values()].sort((a, b) => a.program.localeCompare(b.program));
}
