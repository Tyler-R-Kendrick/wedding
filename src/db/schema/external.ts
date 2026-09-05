import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

export const EXTERNAL_ACTION_KINDS = ['gift_link', 'reservation_link', 'reservation_prepare', 'transport_claim'] as const;
export type ExternalActionKind = (typeof EXTERNAL_ACTION_KINDS)[number];
export const EXTERNAL_ACTION_STATUSES = ['initiated', 'prepared', 'committed', 'failed'] as const;
export type ExternalActionStatus = (typeof EXTERNAL_ACTION_STATUSES)[number];

/**
 * Every external handoff or commit (ADR-0004) leaves a record: what, with which provider,
 * for whom, and the outcome. A record of an `initiated` handoff means a link was handed to
 * the guest — never that anything was bought, booked, or redeemed. Only the target host is
 * stored, never the full URL (deep links carry dates/party sizes), and never a secret.
 */
export const externalActionRecords = pgTable(
  'external_action_records',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<ExternalActionKind>().notNull(),
    provider: text('provider').notNull(),
    status: text('status').$type<ExternalActionStatus>().notNull(),
    actor: jsonb('actor').$type<PrincipalRef>().notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    urlHost: text('url_host'),
    surface: text('surface').notNull(),
    requestId: text('request_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('external_action_records_kind_at_idx').on(t.kind, t.createdAt), index('external_action_records_target_idx').on(t.targetType, t.targetId)],
);

export type ExternalActionRecordRow = typeof externalActionRecords.$inferSelect;
