import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { AuditAction, AuditOutcome } from '@/contracts/audit';
import type { PrincipalRef } from '@/contracts/principal';

/** Append-only. Never updated or deleted by application code. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    actor: jsonb('actor').$type<PrincipalRef>().notNull(),
    action: text('action').$type<AuditAction>().notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    outcome: text('outcome').$type<AuditOutcome>().notNull(),
    requestId: text('request_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('audit_events_action_at_idx').on(t.action, t.at),
    index('audit_events_target_idx').on(t.targetType, t.targetId),
    index('audit_events_request_idx').on(t.requestId),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
