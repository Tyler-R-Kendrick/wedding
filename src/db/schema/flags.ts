import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

/** Readiness switches for READINESS_GATED flags: env flag AND readiness row must both be on. */
export const featureFlags = pgTable('feature_flags', {
  name: text('name').primaryKey(),
  readiness: boolean('readiness').notNull().default(false),
  updatedBy: jsonb('updated_by').$type<PrincipalRef>(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
