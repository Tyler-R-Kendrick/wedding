import { logger } from './logger';

/**
 * Minimal counters and histograms. Points are buffered and flushed to a sink:
 * console (dev), the `metrics` table (prod), or nothing (test). No third-party telemetry.
 */
export interface MetricPoint {
  name: string;
  kind: 'counter' | 'histogram';
  value: number;
  labels?: Record<string, string>;
  at: Date;
}

export interface MetricsSink {
  write(points: MetricPoint[]): Promise<void>;
}

export class ConsoleMetricsSink implements MetricsSink {
  async write(points: MetricPoint[]): Promise<void> {
    for (const p of points) logger.debug({ metric: p.name, kind: p.kind, value: p.value, labels: p.labels }, 'metric');
  }
}

export class NoopMetricsSink implements MetricsSink {
  async write(): Promise<void> {}
}

/** Writes to the `metrics` table. Imports the DB lazily so this module stays cheap to load. */
export class DbMetricsSink implements MetricsSink {
  async write(points: MetricPoint[]): Promise<void> {
    if (points.length === 0) return;
    const [{ getDb }, { metrics }] = await Promise.all([import('@/db/client'), import('@/db/schema')]);
    const db = await getDb();
    await db.insert(metrics).values(points.map((p) => ({ name: p.name, kind: p.kind, value: p.value, labels: p.labels ?? null, at: p.at })));
  }
}

export class MemoryMetricsSink implements MetricsSink {
  readonly points: MetricPoint[] = [];
  async write(points: MetricPoint[]): Promise<void> {
    this.points.push(...points);
  }
}

export interface MetricsOptions {
  flushIntervalMs?: number;
  maxBuffer?: number;
}

export class Metrics {
  private buffer: MetricPoint[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly flushIntervalMs: number;
  private readonly maxBuffer: number;

  constructor(private sink: MetricsSink, opts: MetricsOptions = {}) {
    this.flushIntervalMs = opts.flushIntervalMs ?? 5_000;
    this.maxBuffer = opts.maxBuffer ?? 200;
  }

  setSink(sink: MetricsSink): void {
    this.sink = sink;
  }

  counter(name: string, value = 1, labels?: Record<string, string>): void {
    this.push({ name, kind: 'counter', value, labels, at: new Date() });
  }

  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.push({ name, kind: 'histogram', value, labels, at: new Date() });
  }

  /** Times an async operation and records `<name>` as a histogram in ms. */
  async time<T>(name: string, fn: () => Promise<T>, labels?: Record<string, string>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.histogram(name, Math.round(performance.now() - start), labels);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return;
    try {
      await this.sink.write(batch);
    } catch (e) {
      logger.warn({ err: e, dropped: batch.length }, 'metrics flush failed');
    }
  }

  private push(p: MetricPoint): void {
    this.buffer.push(p);
    if (this.buffer.length >= this.maxBuffer) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    }
  }
}

function defaultSink(): MetricsSink {
  const mode = process.env.METRICS_SINK ?? (process.env.NODE_ENV === 'production' ? 'db' : process.env.NODE_ENV === 'test' ? 'none' : 'console');
  if (mode === 'db') return new DbMetricsSink();
  if (mode === 'none') return new NoopMetricsSink();
  return new ConsoleMetricsSink();
}

const g = globalThis as unknown as { __weddingMetrics?: Metrics };
export const metrics: Metrics = g.__weddingMetrics ?? (g.__weddingMetrics = new Metrics(defaultSink()));
