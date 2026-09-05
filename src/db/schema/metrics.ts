import { bigserial, doublePrecision, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Metrics sink for production (no third-party telemetry). Sampled/aggregated by ops queries. */
export const metrics = pgTable(
  'metrics',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    kind: text('kind').$type<'counter' | 'histogram'>().notNull(),
    value: doublePrecision('value').notNull(),
    labels: jsonb('labels').$type<Record<string, string>>(),
    at: timestamp('at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('metrics_name_at_idx').on(t.name, t.at)],
);
