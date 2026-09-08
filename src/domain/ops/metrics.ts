import { and, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { metrics } from '@/db/schema';

export interface MetricSeries {
  name: string;
  kind: 'counter' | 'histogram';
  points: number;
  /** Counters: the total. Histograms: the sum of observations (rarely meaningful on its own). */
  sum: number;
  min: number;
  max: number;
  /** Histograms only; null for counters, where a percentile of "1" says nothing. */
  p50: number | null;
  p95: number | null;
  firstAt: string;
  lastAt: string;
}

export interface MetricsRollup {
  windowHours: number;
  since: string;
  /** Rows kept before housekeeping deletes them (`METRICS_RETENTION_DAYS`). */
  retentionDays: number;
  /**
   * False when this deployment writes no metrics at all (`METRICS_SINK=none`, which is the setting
   * in tests and can be set in any environment). Without it an empty table reads as "nothing
   * happened" rather than "nothing is being recorded".
   */
  recording: boolean;
  sink: string;
  totalPoints: number;
  series: MetricSeries[];
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * Aggregates the `metrics` table over a window. The table is the only telemetry store in this
 * deployment (no third-party sink), so this is the whole picture; it is deliberately computed in
 * SQL rather than by reading rows, because a busy window is tens of thousands of points.
 */
export async function metricsRollup(db: Db, opts: { now: Date; windowHours: number; retentionDays: number; sink: string }): Promise<MetricsRollup> {
  const since = new Date(opts.now.getTime() - opts.windowHours * 3_600_000);
  const rows = await db
    .select({
      name: metrics.name,
      kind: metrics.kind,
      points: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(${metrics.value}), 0)`,
      min: sql<number>`coalesce(min(${metrics.value}), 0)`,
      max: sql<number>`coalesce(max(${metrics.value}), 0)`,
      p50: sql<number | null>`percentile_cont(0.5) within group (order by ${metrics.value})`,
      p95: sql<number | null>`percentile_cont(0.95) within group (order by ${metrics.value})`,
      firstAt: sql<string>`min(${metrics.at})`,
      lastAt: sql<string>`max(${metrics.at})`,
    })
    .from(metrics)
    .where(and(gte(metrics.at, since)))
    .groupBy(metrics.name, metrics.kind);

  const series: MetricSeries[] = rows
    .map((r) => ({
      name: r.name,
      kind: r.kind,
      points: num(r.points),
      sum: Math.round(num(r.sum) * 1000) / 1000,
      min: Math.round(num(r.min) * 1000) / 1000,
      max: Math.round(num(r.max) * 1000) / 1000,
      p50: r.kind === 'histogram' ? Math.round(num(r.p50)) : null,
      p95: r.kind === 'histogram' ? Math.round(num(r.p95)) : null,
      firstAt: new Date(r.firstAt).toISOString(),
      lastAt: new Date(r.lastAt).toISOString(),
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  return {
    windowHours: opts.windowHours,
    since: since.toISOString(),
    retentionDays: opts.retentionDays,
    recording: opts.sink !== 'none',
    sink: opts.sink,
    totalPoints: series.reduce((t, s) => t + s.points, 0),
    series,
  };
}
