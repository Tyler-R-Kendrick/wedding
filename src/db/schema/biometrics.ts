import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgSchema, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

/**
 * Biometric vault (Swarm I). ADR-0006: everything face-related lives in its own Postgres schema
 * (`biometric.*`), is written only through the gated domain in src/domain/biometrics, and is
 * never referenced from the public schema or the generic vector index. Templates are sealed with
 * a separate vault key (src/domain/biometrics/vault.ts) before they touch the database.
 *
 * The consent ledger is APPEND-ONLY: grants and revocations are separate rows; nothing is ever
 * updated or deleted by application code (the deletion job removes templates and matches, and
 * writes a deletion record; consent history is retained as evidence).
 *
 * This is engineering readiness, not legal advice: see docs/architecture/biometrics-bipa-readiness.md.
 */
export const biometricSchema = pgSchema('biometric');

export const CONSENT_ENTRIES = ['grant', 'revoke'] as const;
export type ConsentEntry = (typeof CONSENT_ENTRIES)[number];

/** v1 scope: a guest may only match their own face against photos they choose (ADR-0006 §3). */
export const CONSENT_SCOPES = ['self_match'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const biometricConsents = biometricSchema.table(
  'consents',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id').notNull(),
    householdId: text('household_id').notNull(),
    entry: text('entry').$type<ConsentEntry>().notNull(),
    /** For revoke entries: the grant being withdrawn. */
    grantId: text('grant_id'),
    policyVersion: text('policy_version').notNull(),
    /** SHA-256 of the exact text shown, so a later copy change can never be mistaken for this consent. */
    textHash: text('text_hash').notNull(),
    /** The exact text the guest saw (ADR-0006 §3). */
    text: text('text').notNull(),
    purpose: text('purpose').notNull(),
    term: text('term').notNull(),
    retention: text('retention').notNull(),
    providerDisclosure: text('provider_disclosure').notNull(),
    scope: text('scope').$type<ConsentScope>().notNull().default('self_match'),
    /** The guest attested to being 18 or older; minors are blocked pending a guardian-consent design. */
    adultAttested: boolean('adult_attested').notNull().default(false),
    /** Keyed hash of the client IP at the moment of consent (never the IP itself). */
    ipHash: text('ip_hash'),
    surface: text('surface').notNull().default('ui'),
    requestId: text('request_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('biometric_consents_guest_idx').on(t.guestId, t.createdAt),
    index('biometric_consents_grant_idx').on(t.grantId),
    /**
     * At most one OPEN grant per guest. Two flows racing (two browser tabs, two valid draft
     * tokens, two idempotency keys) could both read "no consent yet" and both append a grant,
     * leaving the ledger — whose whole purpose is to be reliable evidence — holding two
     * simultaneous grants, and after one withdrawal a grant that could never be withdrawn.
     *
     * Scoped to `revoked_at IS NULL` rather than to the policy version, so a guest who withdraws
     * and later changes their mind can grant again for the same wording. `revokeConsent` stamps
     * `revoked_at` on the grant row it closes; the append-only `revoke` ENTRY beside it still
     * carries the full provenance (who, where, when, which request), and `consentState` still
     * derives status from the entries alone. The stamp is a closure marker, not the evidence.
     */
    uniqueIndex('biometric_consents_one_open_grant_idx')
      .on(t.guestId)
      .where(sql`${t.entry} = 'grant' and ${t.revokedAt} is null`),
  ],
);

/** One enrolled reference per guest per consent: the provider handle plus the sealed template. */
export const biometricIdentityRefs = biometricSchema.table(
  'identity_refs',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id').notNull(),
    consentId: text('consent_id').notNull(),
    providerName: text('provider_name').notNull(),
    /** Provider-side subject handle (opaque). */
    subjectId: text('subject_id').notNull(),
    /** AES-256-GCM ciphertext (base64url) of the template; opened only inside the domain with the vault key. */
    templateSealed: text('template_sealed').notNull(),
    templateKeyId: text('template_key_id').notNull(),
    /** The guest's own assets used as references (derivatives only). */
    sourceAssetIds: jsonb('source_asset_ids').$type<string[]>().notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('biometric_identity_refs_guest_idx').on(t.guestId)],
);

/** Results of consent-scoped matching: which chosen photos matched this guest. No vectors stored. */
export const biometricMatches = biometricSchema.table(
  'matches',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id').notNull(),
    identityRefId: text('identity_ref_id').notNull(),
    assetId: text('asset_id').notNull(),
    score: real('score').notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true, mode: 'date' }).notNull(),
    requestId: text('request_id').notNull(),
  },
  (t) => [index('biometric_matches_guest_idx').on(t.guestId, t.matchedAt), index('biometric_matches_asset_idx').on(t.assetId)],
);

export const DELETION_REASONS = ['guest_request', 'revocation', 'retention', 'guest_deleted', 'admin'] as const;
export type DeletionReason = (typeof DELETION_REASONS)[number];

export const DELETION_STATUSES = ['requested', 'completed', 'failed'] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

export interface DeletionProof {
  identityRefsDeleted: number;
  providerSubjectsDeleted: number;
  matchesDeleted: number;
  vectorEntriesDeleted: number;
  /**
   * Stored capability responses purged from the public `idempotency_keys` table. A biometric
   * result cached there is a copy of the answer outside this schema, so a deletion that did not
   * remove it would be reporting a destruction it had not performed. (Confirmation nonces are not
   * touched: they hold no body and are what keeps a consent token single-use.)
   */
  cachedResponsesDeleted: number;
  /** Vectors left in this guest's biometric namespace afterwards; the index is asked, not assumed. */
  vectorEntriesRemaining: number;
  consentIds: string[];
  completedBy: string;
}

export const biometricDeletions = biometricSchema.table(
  'deletions',
  {
    id: text('id').primaryKey(),
    guestId: text('guest_id').notNull(),
    reason: text('reason').$type<DeletionReason>().notNull(),
    status: text('status').$type<DeletionStatus>().notNull().default('requested'),
    requestedBy: jsonb('requested_by').$type<PrincipalRef>().notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    proof: jsonb('proof').$type<DeletionProof>(),
    error: text('error'),
    jobId: text('job_id'),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('biometric_deletions_guest_idx').on(t.guestId, t.requestedAt), index('biometric_deletions_status_idx').on(t.status, t.requestedAt)],
);

export type BiometricConsentRow = typeof biometricConsents.$inferSelect;
export type BiometricIdentityRefRow = typeof biometricIdentityRefs.$inferSelect;
export type BiometricMatchRow = typeof biometricMatches.$inferSelect;
export type BiometricDeletionRow = typeof biometricDeletions.$inferSelect;
