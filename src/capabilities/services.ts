import type { CapabilityContext } from '@/contracts/capability';
import type { FeatureFlag } from '@/contracts/flags';
import type { ConfirmationService } from '@/policy/confirmation';

/**
 * Services the invoke pipeline itself needs. They are attached to
 * `ctx.services` (typed loosely in the contracts to keep them dependency-free).
 * The app-level factory in `./context.ts` supplies real implementations; tests
 * supply in-memory ones.
 */
export type IdempotencyStatus = 'in_progress' | 'complete';

export interface IdempotencyRecord {
  payloadHash: string;
  /** Present once `status` is `complete`. */
  response: unknown;
  status: IdempotencyStatus;
}

export type IdempotencyReservation = { reserved: true } | { reserved: false; existing: IdempotencyRecord };

/** How long a reservation without an outcome blocks retries (a handler never runs longer than a request). */
export const IDEMPOTENCY_RESERVATION_TTL_SECONDS = 10 * 60;

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  /** Records a completed outcome (upsert); replayed until the TTL passes. */
  set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds?: number): Promise<void>;
  /**
   * Atomically claims (scope, key) before the handler runs. Not reserved when a live row already
   * exists, whether still in progress or complete; the caller decides replay vs. conflict.
   */
  reserve(scope: string, key: string, payloadHash: string, ttlSeconds?: number): Promise<IdempotencyReservation>;
  /** Drops a reservation whose handler failed, so a retry re-runs instead of replaying nothing. */
  release(scope: string, key: string): Promise<void>;
}

export interface MetricsLike {
  counter(name: string, value?: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
}

export interface LoggerLike {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface RateLimiterLike {
  consume(key: string, budget: 'capability'): Promise<{ allowed: boolean; retryAfterMs?: number }>;
}

export interface PipelineServices {
  /**
   * Per-principal capability budget. Consumed inside `invoke`, so every entry point that wires it is
   * limited the same way — the JSON route, server actions, and anything later levels add. Absent
   * means no limiting: fixture contexts in tests opt out, and the budget (60 tokens, 1/s) is far
   * below what a test file spends against one principal.
   */
  limiter?: RateLimiterLike;
  /** Legal/readiness switch lookup for READINESS_GATED flags. Absent means fail closed. */
  readiness?: (flag: FeatureFlag) => Promise<boolean>;
  /** Keyed fingerprint for audit `inputHash` (HMAC with a server key). Absent means no hash is recorded. */
  hashInput?: (value: unknown) => string;
  confirmation?: ConfirmationService;
  idempotency?: IdempotencyStore;
  metrics?: MetricsLike;
  logger?: LoggerLike;
}

export function pipelineServices(ctx: CapabilityContext): PipelineServices {
  return ctx.services as PipelineServices;
}

/** Typed accessor for a named service; throws a clear error when the app forgot to wire it. */
export function requireService<T>(ctx: CapabilityContext, name: string): T {
  const value = ctx.services[name];
  if (value === undefined || value === null) throw new Error(`capability service "${name}" is not available in this context`);
  return value as T;
}

/** In-memory idempotency store for tests and the dev runner. Same reserve-first semantics as the DB store. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, IdempotencyRecord & { expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  private live(scope: string, key: string): (IdempotencyRecord & { expiresAt: number }) | null {
    const row = this.rows.get(`${scope} ${key}`);
    if (!row) return null;
    if (row.expiresAt <= this.now()) {
      this.rows.delete(`${scope} ${key}`);
      return null;
    }
    return row;
  }
  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const row = this.live(scope, key);
    return row ? { payloadHash: row.payloadHash, response: row.response, status: row.status } : null;
  }
  async set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds = 86_400): Promise<void> {
    this.rows.set(`${scope} ${key}`, { payloadHash, response, status: 'complete', expiresAt: this.now() + ttlSeconds * 1000 });
  }
  async reserve(scope: string, key: string, payloadHash: string, ttlSeconds = IDEMPOTENCY_RESERVATION_TTL_SECONDS): Promise<IdempotencyReservation> {
    const row = this.live(scope, key);
    if (row) return { reserved: false, existing: { payloadHash: row.payloadHash, response: row.response, status: row.status } };
    this.rows.set(`${scope} ${key}`, { payloadHash, response: null, status: 'in_progress', expiresAt: this.now() + ttlSeconds * 1000 });
    return { reserved: true };
  }
  async release(scope: string, key: string): Promise<void> {
    this.rows.delete(`${scope} ${key}`);
  }
}
