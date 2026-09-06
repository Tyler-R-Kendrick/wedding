import type { CapabilityContext, CapabilityExposure } from '@/contracts/capability';
import type { IdempotencyKey } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import type { TrustClass } from '@/contracts/provenance';
import { getDb, type Db } from '@/db/client';
import { getAuditSink } from '@/lib/audit';
import { hmacSha256, keyedHash } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getFlags, isReady } from '@/lib/flags';
import { DbIdempotencyStore } from '@/lib/idempotency';
import { logger, requestLogger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { getProvider } from '@/providers/registry';
import { DEV_CONFIRMATION_SECRET, getConfirmationService } from '@/policy/confirmation';
import type { PipelineServices } from './services';

let auditKey: string | undefined;
/** AUDIT_HASH_KEY when set; otherwise derived from (never equal to) the confirmation secret. */
function auditHashKey(): string {
  return (auditKey ??= env.AUDIT_HASH_KEY ?? hmacSha256(env.CONFIRMATION_SECRET ?? DEV_CONFIRMATION_SECRET, 'audit-input-hash'));
}
const hashInput = (value: unknown): string => keyedHash(auditHashKey(), value);

/** Everything a handler may reach through `ctx.services` in the running app. */
export interface AppServices extends PipelineServices {
  db: Db;
  providers: typeof getProvider;
  [key: string]: unknown;
}

export interface CreateContextInput {
  principal: Principal;
  requestId: string;
  surface?: keyof CapabilityExposure;
  idempotencyKey?: string;
  confirmationToken?: string;
  inputTrust?: TrustClass;
  view?: { theme?: string; lifecycle?: string };
  now?: Date;
  /**
   * Wire the per-principal rate limiter. Set by callers that front a real request — the JSON
   * capability route and the guest/admin server actions — so the pipeline enforces one budget for
   * all of them. Left off for in-process callers such as tests and seeding.
   */
  rateLimit?: boolean;
}

/** Builds a context wired to the real database, audit sink, providers, and policy services. */
export async function createCapabilityContext(input: CreateContextInput): Promise<CapabilityContext & { services: AppServices }> {
  const [db, audit, confirmation] = await Promise.all([getDb(), getAuditSink(), getConfirmationService()]);
  const services: AppServices = {
    db,
    providers: (kind, deps = {}) => getProvider(kind, { db, ...deps }),
    readiness: (flag) => isReady(flag, db),
    hashInput,
    confirmation,
    idempotency: new DbIdempotencyStore(db),
    metrics,
    logger: input.requestId ? requestLogger(input.requestId) : logger,
    ...(input.rateLimit ? { limiter: getProvider('rate-limit', { db }) } : {}),
  };
  return {
    principal: input.principal,
    requestId: input.requestId,
    now: input.now ?? new Date(),
    flags: getFlags(),
    audit,
    inputTrust: input.inputTrust ?? 'UNTRUSTED_USER_CONTENT', // only server-side callers may opt into TRUSTED_WEDDING
    idempotencyKey: input.idempotencyKey as IdempotencyKey | undefined,
    confirmationToken: input.confirmationToken,
    view: input.view,
    surface: input.surface ?? 'ui',
    services,
  };
}

export function appServices(ctx: CapabilityContext): AppServices {
  return ctx.services as unknown as AppServices;
}
