import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/** Stored capability responses keyed by (scope, key); replayed for 24h. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_keys_expires_idx').on(t.expiresAt)],
);
