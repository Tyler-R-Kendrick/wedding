import type { CapabilityContext } from '@/contracts/capability';
import type { FeatureFlag } from '@/contracts/flags';
import type { ConfirmationService } from '@/policy/confirmation';

/**
 * Services the invoke pipeline itself needs. They are attached to
 * `ctx.services` (typed loosely in the contracts to keep them dependency-free).
 * The app-level factory in `./context.ts` supplies real implementations; tests
 * supply in-memory ones.
 */
export interface IdempotencyRecord {
  payloadHash: string;
  response: unknown;
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds?: number): Promise<void>;
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

export interface PipelineServices {
  /** Legal/readiness switch lookup for READINESS_GATED flags. Absent means fail closed. */
  readiness?: (flag: FeatureFlag) => Promise<boolean>;
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

/** In-memory idempotency store for tests and the dev runner. */
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly rows = new Map<string, IdempotencyRecord & { expiresAt: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const row = this.rows.get(`${scope} ${key}`);
    if (!row) return null;
    if (row.expiresAt <= this.now()) {
      this.rows.delete(`${scope} ${key}`);
      return null;
    }
    return { payloadHash: row.payloadHash, response: row.response };
  }
  async set(scope: string, key: string, payloadHash: string, response: unknown, ttlSeconds = 86_400): Promise<void> {
    this.rows.set(`${scope} ${key}`, { payloadHash, response, expiresAt: this.now() + ttlSeconds * 1000 });
  }
}
