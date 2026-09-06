import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AdminRole, PrincipalRef } from '@/contracts/principal';
import { authUsers } from './auth';

/**
 * Guest domain (ADR-0001). Guests are people as printed on the invitation; households are
 * the RSVP unit; invitations carry the discovery token; bindings tie an AuthIdentity to a
 * Guest. Nothing here holds credentials, and nothing in the auth tables holds guest facts.
 */

export const GUEST_KINDS = ['adult', 'child', 'plus_one'] as const;
export type GuestKind = (typeof GUEST_KINDS)[number];

export const INVITATION_STATUSES = ['issued', 'claimed', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const BINDING_ROLES = ['self', 'household_manager', 'delegate'] as const;
export type BindingRole = (typeof BINDING_ROLES)[number];

export const CLAIM_METHODS = ['otp', 'passkey', 'admin'] as const;
export type ClaimMethod = (typeof CLAIM_METHODS)[number];

export const households = pgTable('households', {
  id: text('id').primaryKey(),
  /** As printed on the envelope: "The Fitzgerald Family", "Ana Ruiz & Guest". */
  name: text('name').notNull(),
  /** Guest who manages RSVP for the household. No FK to avoid the households<->guests cycle; validated in the domain. */
  managerGuestId: text('manager_guest_id'),
  /** Postal address for mail merges. Sensitive: admin-only, never exported by default. */
  mailingAddress: jsonb('mailing_address').$type<{ line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string }>(),
  /** Admin-only notes (never shown to guests, never in default exports). */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const guests = pgTable(
  'guests',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull().default(''),
    /** Lower-cased, trimmed. Optional: children and some adults have none. */
    email: text('email'),
    kind: text('kind').$type<GuestKind>().notNull().default('adult'),
    isMinor: boolean('is_minor').notNull().default(false),
    /** Unnamed plus-ones become named when the inviting guest RSVPs. */
    isNamed: boolean('is_named').notNull().default(true),
    /** Guest whose plus-one this is (kind = plus_one). */
    plusOneOfGuestId: text('plus_one_of_guest_id'),
    /** Another guest who acts for this one (no email, minor, or by request). Defaults to the household manager. */
    managedByGuestId: text('managed_by_guest_id'),
    /** Set when an admin merged this duplicate into another guest; merged rows are inert. */
    mergedIntoGuestId: text('merged_into_guest_id'),
    /** Admin-only notes (never shown to guests, never in default exports). */
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('guests_household_idx').on(t.householdId), index('guests_email_idx').on(t.email), index('guests_managed_by_idx').on(t.managedByGuestId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** SHA-256 of the discovery token. The token itself is shown once at issue time and never stored. */
    tokenHash: text('token_hash').notNull(),
    /** First characters of the token so admins can match a printed card to a row. Never enough to guess the token. */
    tokenPrefix: text('token_prefix').notNull(),
    status: text('status').$type<InvitationStatus>().notNull().default('issued'),
    /** Event keys this invitation covers (Swarm E's event_entitlements are authoritative once they exist). */
    eventKeys: jsonb('event_keys').$type<string[]>().notNull().default([]),
    plusOneAllowance: integer('plus_one_allowance').notNull().default(0),
    childrenAllowance: integer('children_allowance').notNull().default(0),
    issuedAt: timestamp('issued_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: text('revoked_reason'),
    /** Set on the new row when a token is rotated; the old row is revoked. */
    rotatedFromId: text('rotated_from_id'),
    issuedBy: jsonb('issued_by').$type<PrincipalRef>().notNull(),
  },
  (t) => [uniqueIndex('invitations_token_hash_idx').on(t.tokenHash), index('invitations_household_idx').on(t.householdId)],
);

export const guestAccessBindings = pgTable(
  'guest_access_bindings',
  {
    id: text('id').primaryKey(),
    authIdentityId: text('auth_identity_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    guestId: text('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    role: text('role').$type<BindingRole>().notNull().default('self'),
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    claimMethod: text('claim_method').$type<ClaimMethod>().notNull(),
    /** Invitation used to claim, when any. */
    invitationId: text('invitation_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: jsonb('revoked_by').$type<PrincipalRef>(),
    revokedReason: text('revoked_reason'),
    /** Binding this one replaced (admin rebind), for the audit trail. */
    reboundFromId: text('rebound_from_id'),
  },
  (t) => [
    index('guest_access_bindings_identity_idx').on(t.authIdentityId),
    index('guest_access_bindings_guest_idx').on(t.guestId),
    /** One active binding per guest, enforced by the database (review S9): concurrent claims cannot both win. */
    uniqueIndex('guest_access_bindings_one_active').on(t.guestId).where(sql`${t.revokedAt} is null`),
  ],
);

export const OTP_ATTEMPT_KINDS = ['send', 'verify'] as const;
export type OtpAttemptKind = (typeof OTP_ATTEMPT_KINDS)[number];
export const OTP_ATTEMPT_OUTCOMES = ['sent', 'suppressed', 'verified', 'failed', 'locked', 'rate_limited'] as const;
export type OtpAttemptOutcome = (typeof OTP_ATTEMPT_OUTCOMES)[number];

/**
 * One row per OTP send/verify attempt, keyed by hashed email and hashed IP. Drives the
 * failed-attempt lockout and gives admins an abuse view. Codes are never stored here.
 */
export const otpAttempts = pgTable(
  'otp_attempts',
  {
    id: text('id').primaryKey(),
    emailHash: text('email_hash').notNull(),
    ipHash: text('ip_hash').notNull(),
    purpose: text('purpose').notNull(),
    kind: text('kind').$type<OtpAttemptKind>().notNull(),
    outcome: text('outcome').$type<OtpAttemptOutcome>().notNull(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('otp_attempts_email_at_idx').on(t.emailHash, t.at), index('otp_attempts_ip_at_idx').on(t.ipHash, t.at)],
);

/** Admin roles by verified email. ADMIN_EMAILS (env) grants `owner` without a row. */
export const adminRoles = pgTable('admin_roles', {
  email: text('email').primaryKey(),
  role: text('role').$type<AdminRole>().notNull(),
  grantedBy: jsonb('granted_by').$type<PrincipalRef>().notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type HouseholdRow = typeof households.$inferSelect;
export type GuestRow = typeof guests.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type GuestAccessBindingRow = typeof guestAccessBindings.$inferSelect;
export type OtpAttemptRow = typeof otpAttempts.$inferSelect;
export type AdminRoleRow = typeof adminRoles.$inferSelect;
