import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

export const ENTITLEMENT_STATUSES = ['active', 'revoked'] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/**
 * A ride benefit assigned to ONE guest by an admin (brief §3.2: household managers manage
 * RSVP, individuals own benefits). Amount, validity and geofence are admin-entered text
 * until the Uber programme terms are known (backlog P-05) — never invented.
 */
export const transportationEntitlements = pgTable(
  'transportation_entitlements',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id').notNull(),
    householdId: text('household_id').notNull(),
    /** Admin-chosen programme key (e.g. "reception-ride-home"); one entitlement per guest per programme. */
    program: text('program').notNull().default('reception-ride-home'),
    /** Provider-side programme/campaign reference (Uber voucher programme id), never a secret. */
    providerProgramRef: text('provider_program_ref'),
    amountNote: text('amount_note'),
    validityNote: text('validity_note'),
    geofenceNote: text('geofence_note'),
    /** Conservative eligibility fact until the identity swarm's fact source supplies it: minors never claim. */
    guestIsMinor: boolean('guest_is_minor').notNull().default(false),
    status: text('status').$type<EntitlementStatus>().notNull().default('active'),
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
    /** content_sources.id backing the programme terms (provenance), when known. */
    sourceId: text('source_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    assignedBy: jsonb('assigned_by').$type<PrincipalRef>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transportation_entitlements_guest_program_idx').on(t.guestId, t.program),
    index('transportation_entitlements_household_idx').on(t.householdId),
  ],
);

export const CLAIM_STATUSES = ['pending', 'issued', 'failed', 'revoked'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const REDEMPTION_KINDS = ['link', 'code', 'none'] as const;
export type RedemptionKind = (typeof REDEMPTION_KINDS)[number];

/**
 * One claim per entitlement, enforced here (unique index) as well as in the pipeline.
 * The redemption link/code is a secret: sealed with the transport vault, never logged,
 * never returned to anyone but the owning guest on the ui surface.
 */
export const transportationClaims = pgTable(
  'transportation_claims',
  {
    id: text('id').primaryKey(),
    entitlementId: text('entitlement_id').notNull(),
    guestId: text('guest_id').notNull(),
    householdId: text('household_id').notNull(),
    status: text('status').$type<ClaimStatus>().notNull().default('pending'),
    providerName: text('provider_name').notNull(),
    /** Provider-side reference (voucher id), never the redemption secret. */
    providerRef: text('provider_ref'),
    redemptionKind: text('redemption_kind').$type<RedemptionKind>().notNull().default('none'),
    /** Sealed redemption link or code (AES-256-GCM, see src/domain/external/vault.ts). */
    secretCiphertext: text('secret_ciphertext'),
    secretKeyId: text('secret_key_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    /** Guest-safe reason when status is failed (never the provider's raw error). */
    failureReason: text('failure_reason'),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('transportation_claims_entitlement_idx').on(t.entitlementId), index('transportation_claims_guest_idx').on(t.guestId)],
);

export const MANUAL_CODE_STATUSES = ['available', 'issued', 'revoked'] as const;
export type ManualCodeStatus = (typeof MANUAL_CODE_STATUSES)[number];

/** Admin-uploaded ride codes for manual-code mode. Unclaimed codes are secrets: sealed at rest, deduplicated by keyed hash. */
export const transportationManualCodes = pgTable(
  'transportation_manual_codes',
  {
    id: text('id').primaryKey(),
    program: text('program').notNull(),
    codeCiphertext: text('code_ciphertext').notNull(),
    codeKeyId: text('code_key_id').notNull(),
    /** Keyed hash of (program, code) so a re-upload is a no-op and never a duplicate. */
    codeHash: text('code_hash').notNull(),
    status: text('status').$type<ManualCodeStatus>().notNull().default('available'),
    claimId: text('claim_id'),
    uploadedBy: jsonb('uploaded_by').$type<PrincipalRef>().notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('transportation_manual_codes_hash_idx').on(t.codeHash),
    uniqueIndex('transportation_manual_codes_claim_idx').on(t.claimId),
    index('transportation_manual_codes_program_status_idx').on(t.program, t.status),
  ],
);

export type TransportationEntitlementRow = typeof transportationEntitlements.$inferSelect;
export type TransportationClaimRow = typeof transportationClaims.$inferSelect;
export type TransportationManualCodeRow = typeof transportationManualCodes.$inferSelect;
