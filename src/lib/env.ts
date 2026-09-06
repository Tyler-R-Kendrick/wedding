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

const optionalInt = (min: number, max: number) =>
  z.preprocess((v) => (v === undefined || v === '' ? undefined : Number(v)), z.number().int().min(min).max(max).optional());

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
  CRON_SECRET: optionalSecret(32),
  STORAGE_SIGNING_SECRET: optionalSecret(16),
  /** Alias written by the secrets autofill; used as the local-fs signing secret when STORAGE_SIGNING_SECRET is unset. */
  DEV_STORAGE_SECRET: optionalSecret(16),
  BETTER_AUTH_SECRET: optionalSecret(16),
  BETTER_AUTH_URL: optionalUrl,
  /** Number of trusted reverse proxies in front of the app. 0 = ignore forwarding headers. Default: 1 on Vercel, else 0. */
  TRUSTED_PROXY_HOPS: optionalInt(0, 16),
  /** Bearer that unlocks GET/DELETE /api/dev/inbox outside local development (previews). */
  DEV_INBOX_TOKEN: optionalSecret(16),
  /** Bearer that unlocks the provider/driver details on /api/health (admins see them without it). */
  HEALTH_TOKEN: optionalSecret(16),
  /** Key for audit inputHash (HMAC). Unset -> derived from CONFIRMATION_SECRET. */
  AUDIT_HASH_KEY: optionalSecret(16),
  /**
   * Test-only principal injection for e2e (src/webmcp/server/test-principal.ts). Honoured ONLY
   * when NODE_ENV=test; identity (Better Auth) is a later level, so until then end-to-end tests
   * have no other way to be a signed-in guest. Never set outside a test run.
   */
  TEST_AUTH_SECRET: optionalSecret(16),

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
  /** housekeeping.purge keeps `metrics` rows this many days. */
  METRICS_RETENTION_DAYS: intish(30, 1),
});

type Parsed = z.infer<typeof serverSchema>;

export type ServerEnv = Omit<Parsed, 'TRUSTED_PROXY_HOPS'> & {
  /** Resolved (never undefined): explicit value, else 1 on Vercel, else 0. */
  TRUSTED_PROXY_HOPS: number;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
};

const hasS3 = (e: Parsed) => !!(e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY);

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
  /**
   * A deployed app is never a test run. `NODE_ENV=test` is a plausible thing to set on a stage
   * called "test", and it disables every production secret check below, silently falls back to the
   * committed confirmation secret, and opens the test-principal gate. Refuse to boot instead.
   * CI is deliberately not a marker here: CI runs the test suite, and that is exactly what
   * NODE_ENV=test is for.
   */
  if (e.NODE_ENV === 'test' && (source.VERCEL || source.VERCEL_ENV)) {
    throw new Error('NODE_ENV=test is not allowed on a deployed app (VERCEL is set). Use development or production.');
  }
  if (isProduction && !isBuildPhase) {
    const required: (keyof Parsed)[] = ['CONFIRMATION_SECRET', 'CRON_SECRET'];
    const missing: string[] = required.filter((k) => !e[k]);
    // Storage must be S3 or a deliberately configured local-fs signing secret; the committed dev default is never used in production.
    if (!hasS3(e) && !e.STORAGE_SIGNING_SECRET && !e.DEV_STORAGE_SECRET) {
      missing.push('STORAGE_SIGNING_SECRET (or S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY)');
    }
    // Vercel production must not silently run on ephemeral /tmp PGlite; previews may.
    if (source.VERCEL_ENV === 'production' && !e.DATABASE_URL) missing.push('DATABASE_URL (VERCEL_ENV=production)');
    if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    if (e.RATE_LIMIT_BACKEND === 'memory') throw new Error('RATE_LIMIT_BACKEND=memory is not allowed in production (per-process buckets are not a rate limit behind a load balancer)');
  }
  const TRUSTED_PROXY_HOPS = e.TRUSTED_PROXY_HOPS ?? (source.VERCEL ? 1 : 0);
  /**
   * With 0 hops every forwarding header is ignored (correctly — nothing overwrites them), so every
   * client collapses to the single `direct` rate-limit bucket and one visitor can hold the whole
   * site's anonymous budget down. That is the right default when nothing is in front of the app,
   * and the wrong one behind nginx/Cloudflare, so say so out loud rather than failing quietly.
   * console, not the logger: this runs at first import, before anything is configured.
   */
  if (TRUSTED_PROXY_HOPS === 0 && isProduction && !isBuildPhase) {
    console.warn(
      '[env] TRUSTED_PROXY_HOPS=0: forwarding headers are ignored and every client shares one rate-limit bucket. Set it to the number of proxies in front of this app.',
    );
  }
  return { ...e, TRUSTED_PROXY_HOPS, isProduction, isTest: e.NODE_ENV === 'test', isDevelopment: e.NODE_ENV === 'development' };
}

export const env: ServerEnv = load(process.env);

/** For tests: parse an arbitrary env record with the same rules. */
export const parseServerEnv = (source: Record<string, string | undefined>): ServerEnv => load(source as NodeJS.ProcessEnv);
