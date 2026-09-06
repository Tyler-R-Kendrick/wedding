import { doublePrecision, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Token buckets for the DB-backed rate limiter (multi-instance safe). */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
