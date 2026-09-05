import 'server-only';
import { z } from 'zod';
import { publicEnv } from './env.public';

export { publicEnv };

/**
 * Server environment, validated once at first import. Every provider variable is optional:
 * the provider registry falls back to its mock when unconfigured. Malformed values fail fast
 * (the process refuses to start) — a misconfigured secret must never silently become "mock".
 */
const TRUTHY = new Set(['1', 'true', 'on', 'yes']);
const FALSY = new Set(['0', 'false', 'off', 'no']);

const boolish = (fallback: boolean | undefined) =>
  z.preprocess((v) => {
    if (v === undefined || v === '') return fallback;
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase();
    if (TRUTHY.has(s)) return true;
    if (FALSY.has(s)) return false;
    return v; // let zod report it
  }, z.boolean().optional());

const requiredBool = (fallback: boolean) => boolish(fallback).pipe(z.boolean());

const intish = (fallback: number, min = 0) =>
  z.preprocess((v) => (v === undefined || v === '' ? fallback : Number(v)), z.number().int().min(min));

const optionalString = z.string().trim().min(1).optional().or(z.literal('').transform(() => undefined));
const optionalSecret = (min: number) => z.string().min(min).optional().or(z.literal('').transform(() => undefined));
const optionalUrl = z.url().optional().or(z.literal('').transform(() => undefined));

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

  // --- database ---
  DATABASE_URL: optionalUrl,
  PGLITE_MEMORY: requiredBool(false),
  PGLITE_DATA_DIR: z.string().default('./.data/pglite'),
  /** Apply migrations on first connection. Default: on outside production; set DB_AUTO_MIGRATE=1 for single-instance production. */
  DB_AUTO_MIGRATE: boolish(undefined),
  /** Idempotent brief-derived seed after auto-migrate. Default: on outside production. */
  DB_AUTO_SEED: boolish(undefined),

  // --- security ---
  CONFIRMATION_SECRET: optionalSecret(16),
  CRON_SECRET: optionalSecret(16),
  STORAGE_SIGNING_SECRET: optionalSecret(16),
  BETTER_AUTH_SECRET: optionalSecret(16),
  BETTER_AUTH_URL: optionalUrl,

  // --- providers (all optional; mock when absent) ---
  FORCE_MOCK_PROVIDERS: requiredBool(false),
  ANTHROPIC_API_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  VOYAGE_API_KEY: optionalString,
  EMBEDDINGS_PROVIDER: z.enum(['openai', 'voyage']).optional(),
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: requiredBool(true),
  STORAGE_DATA_DIR: z.string().default('./.data/storage'),
  FLIGHTS_PROVIDER: z.enum(['mock', 'deep-link']).optional(),
  HOTELS_PROVIDER: z.enum(['mock', 'deep-link']).optional(),
  /** Reserved for the travel swarm's live adapter; unused at level 03. */
  DUFFEL_API_KEY: optionalString,
  UBER_CLIENT_ID: optionalString,
  UBER_CLIENT_SECRET: optionalString,
  TRANSPORT_BENEFIT_MODE: z.enum(['mock', 'manual-code', 'uber']).default('mock'),
  TRANSPORT_MANUAL_CODES: optionalString,
  REGISTRY_LINKS_JSON: optionalString,
  CASH_FUND_LINKS_JSON: optionalString,
  RATE_LIMIT_BACKEND: z.enum(['memory', 'db']).optional(),
  METRICS_SINK: z.enum(['console', 'db', 'none']).optional(),

  // --- jobs ---
  JOBS_INLINE_RUNNER: requiredBool(true),
  JOBS_POLL_INTERVAL_MS: intish(2_000, 100),
  JOBS_BATCH_SIZE: intish(10, 1),
});

export type ServerEnv = z.infer<typeof serverSchema> & {
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
};

function load(source: NodeJS.ProcessEnv): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    // Names only — never echo values.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid server environment:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  // `next build` evaluates route modules without runtime secrets; the boot-time check still runs when the server starts.
  const isBuildPhase = source.NEXT_PHASE === 'phase-production-build';
  if (isProduction && !isBuildPhase) {
    const required: (keyof typeof e)[] = ['CONFIRMATION_SECRET', 'CRON_SECRET'];
    const missing = required.filter((k) => !e[k]);
    if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  return { ...e, isProduction, isTest: e.NODE_ENV === 'test', isDevelopment: e.NODE_ENV === 'development' };
}

export const env: ServerEnv = load(process.env);

/** For tests: parse an arbitrary env record with the same rules. */
export const parseServerEnv = (source: Record<string, string | undefined>): ServerEnv => load(source as NodeJS.ProcessEnv);
