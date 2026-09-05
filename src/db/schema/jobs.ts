import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Durable background jobs with retries + exponential backoff. Claimed optimistically per row. */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<JobStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    /** Optional de-duplication key: enqueueing the same key while queued/running is a no-op. */
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('jobs_status_run_at_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_key_idx').on(t.dedupeKey),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
