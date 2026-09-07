import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

/** Readiness switches for READINESS_GATED flags: env flag AND readiness row must both be on. */
export const featureFlags = pgTable('feature_flags', {
  name: text('name').primaryKey(),
  readiness: boolean('readiness').notNull().default(false),
  /**
   * Why this switch is where it is, in the words of whoever flipped it: for BIOMETRICS_ENABLED the
   * counsel review that ADR-0006 §7 makes the precondition. Kept on the row it authorises, so the
   * admin page can show what the live state rests on rather than sending someone to correlate
   * timestamps in the audit log. Cleared when a flag is switched off.
   */
  note: text('note'),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
