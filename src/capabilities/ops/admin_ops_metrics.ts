import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { auditTotals, metricsRollup } from '@/domain/ops';
import { env } from '@/lib/env';
import { opsDb } from './_shared';

const input = z.object({ windowHours: z.number().int().min(1).max(720).optional() }).optional();

const output = z.object({
  windowHours: z.number().int(),
  since: z.string(),
  retentionDays: z.number().int(),
  recording: z.boolean(),
  sink: z.string(),
  totalPoints: z.number().int(),
  series: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['counter', 'histogram']),
      points: z.number().int(),
      sum: z.number(),
      min: z.number(),
      max: z.number(),
      p50: z.number().nullable(),
      p95: z.number().nullable(),
      firstAt: z.string(),
      lastAt: z.string(),
    }),
  ),
  audit: z.object({ total: z.number().int(), byOutcome: z.record(z.string(), z.number().int()), topActions: z.array(z.object({ action: z.string(), count: z.number().int() })) }),
});
export type OpsMetricsView = z.infer<typeof output>;

/**
 * The `metrics` table rolled up over a window, plus audit volume for the same window. This is the
 * whole of the deployment's telemetry: there is no third-party sink (ADR-0008), and
 * `METRICS_SINK=none` means nothing is written at all — which `recording` reports, so an empty
 * table cannot be misread as a quiet week.
 *
 * There are no money figures here. Storage cost is estimated on `/admin/media/metrics` from bytes
 * actually stored at a stated assumed price; nothing in this repo knows a provider's real rate, and
 * inventing one would be a fact nobody agreed to.
 */
export const adminOpsMetrics = defineCapability<z.infer<typeof input>, OpsMetricsView>({
  name: 'admin_ops_metrics',
  title: 'Metrics',
  description: 'Counters and histograms recorded in this deployment over a time window (count, sum, min, max, p50, p95), whether metrics are being recorded at all, the retention period, and audit volume by outcome for the same window. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_integrations'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 60_000,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const windowHours = i?.windowHours ?? 24;
    const sink = process.env.METRICS_SINK ?? (env.isProduction ? 'db' : env.isTest ? 'none' : 'console');
    const rollup = await metricsRollup(db, { now: ctx.now, windowHours, retentionDays: env.METRICS_RETENTION_DAYS, sink });
    const audit = await auditTotals(db, { from: new Date(ctx.now.getTime() - windowHours * 3_600_000), to: ctx.now });
    return ok({ data: { ...rollup, audit }, sources: [] });
  },
});
