import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { CapabilityExposure, CapabilityKind } from '@/contracts/capability';
import type { CapabilityErrorCode } from '@/contracts/errors';
import type { TrustClass } from '@/contracts/provenance';

/**
 * Concierge storage (swarm J, ADR-0003). Retention is deliberately minimal:
 *  - `ai_sessions` keeps a short, PII-redacted, truncated tail of the conversation so a guest can
 *    ask a follow-up; rows expire (`expires_at`) and the `ai.purge_sessions` job deletes them, which
 *    cascades to answers, sources and invocations.
 *  - `ai_answers` is the admin trace: what was asked (redacted), what was answered (verified text
 *    only), the verifier verdict, which tools ran. There is no private chain-of-thought to store.
 *  - `ai_answer_sources` is the "Based on…" block, one row per cited source.
 *  - `capability_invocations` records every tool the concierge ran through `invoke` (surface `ai`).
 */
export const AI_ANSWER_STATUSES = ['grounded', 'partial', 'refused', 'confirmation', 'error'] as const;
export type AiAnswerStatus = (typeof AI_ANSWER_STATUSES)[number];

export const AI_INVOCATION_OUTCOMES = ['success', 'denied', 'failed', 'confirmation_required'] as const;
export type AiInvocationOutcome = (typeof AI_INVOCATION_OUTCOMES)[number];

export type AiToolSelector = 'router' | 'model';

/** One redacted, truncated turn kept for follow-ups. Never the raw message. */
export interface AiTurn {
  role: 'user' | 'assistant';
  text: string;
  at: string;
  answerId?: string;
}

export interface AiVerifierSummary {
  method: 'deterministic' | 'deterministic+model';
  claims: number;
  supported: number;
  dropped: number;
  /** Reasons for dropped claims, deduplicated (e.g. "uncited", "unsupported", "untrusted-only"). */
  reasons: string[];
}

export const aiSessions = pgTable(
  'ai_sessions',
  {
    id: text('id').primaryKey(),
    /** `principalKey` from src/policy/confirmation.ts: anonymous | guest:<id> | admin:<id>. Never a name or email. */
    principalKey: text('principal_key').notNull(),
    principalKind: text('principal_kind').notNull(),
    surface: text('surface').$type<keyof CapabilityExposure>().notNull().default('ai'),
    /** Redacted tail (last N turns). */
    turns: jsonb('turns').$type<AiTurn[]>().notNull().default([]),
    turnCount: integer('turn_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('ai_sessions_expires_idx').on(t.expiresAt), index('ai_sessions_principal_idx').on(t.principalKey, t.lastActiveAt)],
);

export const aiAnswers = pgTable(
  'ai_answers',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    principalKey: text('principal_key').notNull(),
    principalKind: text('principal_kind').notNull(),
    /** PII-redacted and truncated. */
    question: text('question').notNull(),
    /** The verified answer as shown to the guest (redacted, truncated). Never the model's raw draft. */
    answer: text('answer').notNull(),
    status: text('status').$type<AiAnswerStatus>().notNull(),
    /** Deterministic router intent label (e.g. "venue.facts", "wedding.protected", "live.flights"). */
    intent: text('intent').notNull(),
    toolsSelected: jsonb('tools_selected').$type<string[]>().notNull().default([]),
    modelId: text('model_id').notNull(),
    verifier: jsonb('verifier').$type<AiVerifierSummary>().notNull(),
    securityAlerts: integer('security_alerts').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('ai_answers_created_idx').on(t.createdAt), index('ai_answers_status_idx').on(t.status, t.createdAt), index('ai_answers_session_idx').on(t.sessionId)],
);

export const aiAnswerSources = pgTable(
  'ai_answer_sources',
  {
    id: text('id').primaryKey(),
    answerId: text('answer_id')
      .notNull()
      .references(() => aiAnswers.id, { onDelete: 'cascade' }),
    /** Marker the answer text uses, e.g. "S1". */
    marker: text('marker').notNull(),
    sourceId: text('source_id').notNull(),
    title: text('title').notNull(),
    /** Public route or official URL. Never a repository path. */
    url: text('url'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    recordRef: jsonb('record_ref').$type<{ type: string; id: string }>(),
    trustClass: text('trust_class').$type<TrustClass>().notNull(),
    /** Present for EXTERNAL_DATA snapshots (ADR-0003 rule 3). */
    retrievedAt: timestamp('retrieved_at', { withTimezone: true, mode: 'date' }),
    /** False when the source was offered to the model but not cited by a surviving sentence. */
    cited: boolean('cited').notNull().default(true),
  },
  (t) => [index('ai_answer_sources_answer_idx').on(t.answerId)],
);

export const capabilityInvocations = pgTable(
  'capability_invocations',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').references(() => aiSessions.id, { onDelete: 'cascade' }),
    answerId: text('answer_id').references(() => aiAnswers.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    capability: text('capability').notNull(),
    kind: text('kind').$type<CapabilityKind>().notNull(),
    surface: text('surface').$type<keyof CapabilityExposure>().notNull(),
    selectedBy: text('selected_by').$type<AiToolSelector>().notNull(),
    outcome: text('outcome').$type<AiInvocationOutcome>().notNull(),
    errorCode: text('error_code').$type<CapabilityErrorCode>(),
    /** Keyed fingerprint (same HMAC as the audit trail); never the input. */
    inputHash: text('input_hash'),
    outputChars: integer('output_chars').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('capability_invocations_at_idx').on(t.at), index('capability_invocations_capability_idx').on(t.capability, t.at)],
);

export type AiSessionRow = typeof aiSessions.$inferSelect;
export type AiAnswerRow = typeof aiAnswers.$inferSelect;
export type AiAnswerSourceRow = typeof aiAnswerSources.$inferSelect;
export type CapabilityInvocationRow = typeof capabilityInvocations.$inferSelect;
