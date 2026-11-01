import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';
import { guests } from './guests';

/**
 * Admin-issued temporary sign-in passes: opaque short URL slug maps to a sealed six-digit code.
 * The slug never encodes the code. Verification is POST-only from the sign-in page.
 */
export const guestSignInPasses = pgTable(
  'guest_sign_in_passes',
  {
    id: text('id').primaryKey(),
    /** Opaque path segment for `/s/<slug>` — random, not derived from the code. */
    slug: text('slug').notNull(),
    guestId: text('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    codeCiphertext: text('code_ciphertext').notNull(),
    codeKeyId: text('code_key_id').notNull(),
    /** Keyed fingerprint for constant-time verification without decrypting. */
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedBy: jsonb('revoked_by').$type<PrincipalRef | null>(),
    issuedBy: jsonb('issued_by').$type<PrincipalRef>().notNull(),
    /** Wrong-code attempts for this pass (cap enforced in the domain). */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('guest_sign_in_passes_slug_idx').on(t.slug), index('guest_sign_in_passes_guest_idx').on(t.guestId), index('guest_sign_in_passes_expires_idx').on(t.expiresAt)],
);

export type GuestSignInPassRow = typeof guestSignInPasses.$inferSelect;
