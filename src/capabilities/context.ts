import type { CapabilityContext, CapabilityExposure } from '@/contracts/capability';
import type { IdempotencyKey } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import type { TrustClass } from '@/contracts/provenance';
import { getDb, type Db } from '@/db/client';
import { getAuditSink } from '@/lib/audit';
import { getFlags, isReady } from '@/lib/flags';
import { DbIdempotencyStore } from '@/lib/idempotency';
import { logger, requestLogger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { getProvider } from '@/providers/registry';
import { getConfirmationService } from '@/policy/confirmation';
import type { PipelineServices } from './services';

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
}

/** Builds a context wired to the real database, audit sink, providers, and policy services. */
export async function createCapabilityContext(input: CreateContextInput): Promise<CapabilityContext & { services: AppServices }> {
  const [db, audit, confirmation] = await Promise.all([getDb(), getAuditSink(), getConfirmationService()]);
  const services: AppServices = {
    db,
    providers: (kind, deps = {}) => getProvider(kind, { db, ...deps }),
    readiness: (flag) => isReady(flag, db),
    confirmation,
    idempotency: new DbIdempotencyStore(db),
    metrics,
    logger: input.requestId ? requestLogger(input.requestId) : logger,
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
