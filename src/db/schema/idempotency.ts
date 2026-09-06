import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const IDEMPOTENCY_STATUSES = ['in_progress', 'complete'] as const;
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUSES)[number];

/**
 * Stored capability responses keyed by (scope, key); replayed for 24h. A row is first
 * *reserved* (`in_progress`, no response) before the handler runs so concurrent retries
 * cannot both execute; it becomes `complete` when the outcome is stored.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status').$type<IdempotencyStatus>().notNull().default('complete'),
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_keys_expires_idx').on(t.expiresAt)],
);
