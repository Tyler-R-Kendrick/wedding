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
  /** Older name for STORAGE_SIGNING_SECRET, still honoured: the local-fs signing secret when that is unset. */
  DEV_STORAGE_SECRET: optionalSecret(16),
  BETTER_AUTH_SECRET: optionalSecret(16),
  BETTER_AUTH_URL: optionalUrl,
  /** Number of trusted reverse proxies in front of the app. 0 = ignore forwarding headers. Default: 1 on Vercel, else 0. */
  TRUSTED_PROXY_HOPS: optionalInt(0, 16),
  /** Bearer that unlocks GET/DELETE /api/dev/inbox outside local development (previews). */
  DEV_INBOX_TOKEN: optionalSecret(16),
  /** Test-only principal injection (x-test-principal); honoured only under NODE_ENV=test. */
  TEST_AUTH_SECRET: optionalSecret(16),
  /** Comma-separated, case-insensitive allowlist of administrator emails (role: owner). */
  ADMIN_EMAILS: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) : []),
    z.array(z.email()),
  ),
  /** Bearer that unlocks the provider/driver details on /api/health (admins see them without it). */
  HEALTH_TOKEN: optionalSecret(16),
  /** Key for audit inputHash (HMAC). Unset -> derived from CONFIRMATION_SECRET. */
  AUDIT_HASH_KEY: optionalSecret(16),

  // --- providers (all optional; mock when absent) ---
  FORCE_MOCK_PROVIDERS: requiredBool(false),
  // No AI provider reads a key: the concierge is written in the guest's browser and everything the
  // server does with language (retrieval, verification, captions) runs in-process. A leftover
  // ANTHROPIC_API_KEY, OPENAI_API_KEY or AI_GATEWAY_API_KEY is ignored (src/providers/ai-model).
  RESEND_CONNECT_USER_ID: optionalString,
  EMAIL_FROM: optionalString,
  /** Required with S3 credentials, and never an AWS host: storage is R2, B2, Supabase or MinIO (src/providers/storage). */
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: requiredBool(true),
  STORAGE_DATA_DIR: z.string().default('./.data/storage'),
  /** Media pipeline (level 10). Caps are per file; parts must be >= 5 MiB on S3/R2 (local-fs accepts smaller for tests). */
  MEDIA_MAX_IMAGE_MB: intish(40, 1),
  MEDIA_MAX_VIDEO_MB: intish(512, 1),
  MEDIA_PART_SIZE_MB: intish(8, 1),
  MEDIA_MULTIPART_THRESHOLD_MB: intish(8, 1),
  /** ffmpeg binary for video posters/probing; the adapter reports what the binary can really do. Unset -> `ffmpeg` on PATH, else mock; `off` -> mock without looking. */
  FFMPEG_PATH: optionalString,
  /** Cloudflare Stream delivery adapter (skeleton). All three required for live mode. */
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_STREAM_API_TOKEN: optionalString,
  CLOUDFLARE_STREAM_CUSTOMER_CODE: optionalString,
  FLIGHTS_PROVIDER: z.enum(['mock', 'deep-link', 'skyscanner', 'duffel-links']).optional(),
  HOTELS_PROVIDER: z.enum(['mock', 'deep-link', 'booking', 'duffel-stays']).optional(),
  /** Travel (level 08): Skyscanner Live Prices, Duffel Links/Stays + signed webhooks, Booking.com Demand API. */
  SKYSCANNER_API_KEY: optionalString,
  DUFFEL_API_KEY: optionalString,
  DUFFEL_WEBHOOK_SECRET: optionalSecret(16),
  BOOKING_DEMAND_API_KEY: optionalString,
  BOOKING_AFFILIATE_ID: optionalString,
  UBER_CLIENT_ID: optionalString,
  UBER_CLIENT_SECRET: optionalString,
  /** Uber for Business organisation + voucher programme (level 09 transport swarm); API base is overridable for sandboxes. */
  UBER_ORG_ID: optionalString,
  UBER_VOUCHER_PROGRAM_ID: optionalString,
  UBER_API_BASE_URL: optionalUrl,
  TRANSPORT_BENEFIT_MODE: z.enum(['mock', 'manual-code', 'uber']).default('mock'),
  TRANSPORT_MANUAL_CODES: optionalString,
  /** AES-256-GCM key material for unclaimed ride codes / redemption links at rest. Unset -> derived from CONFIRMATION_SECRET. */
  TRANSPORT_SECRETS_KEY: optionalSecret(32),
  /** Dev/e2e only: install the cookie-driven test principal resolver (refused in production and on Vercel/CI). */
  RATE_LIMIT_BACKEND: z.enum(['memory', 'db']).optional(),
  METRICS_SINK: z.enum(['console', 'db', 'none']).optional(),

  /*
   * --- jobs ---
   *
   * There is no in-process poller, and there never was. `JOBS_INLINE_RUNNER` and
   * `JOBS_POLL_INTERVAL_MS` sat here and in `.env.example` describing one, and nothing in `src/`
   * read either name — `docs:env` did not catch it because a key defined in this schema counts as
   * "read by the app", so the check can only catch a variable that is undocumented, never one that
   * is documented and dead. Removed rather than implemented: the queue has two real runners, the
   * cron routes in production and `npm run jobs:run` locally, and a third that only exists in a
   * settings table is worse than none.
   */
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

// The endpoint is part of it: without one the AWS SDK picks Amazon, which the storage provider refuses.
const hasS3 = (e: Parsed) => !!(e.S3_ENDPOINT && e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY);

/**
 * Names a Vercel Marketplace connector injects, read as the name the app uses.
 *
 * `vercel integration add supabase` (or `neon`) writes the pooled connection string as
 * `POSTGRES_URL` (Supabase also `POSTGRES_PRISMA_URL`), never `DATABASE_URL`, and a project env
 * cannot reference another. Reading the connector's name here means the deploy script sets
 * nothing by hand and the connector stays the single owner of the value it rotates. An explicit
 * `DATABASE_URL` still wins.
 */
export const DATABASE_URL_ALIASES = ['POSTGRES_URL', 'POSTGRES_PRISMA_URL'] as const;

/**
 * What the platform already knows, read as the names this app uses. Anything set explicitly wins;
 * nothing here applies off Vercel, so local runs and CI are untouched.
 *
 *  - `DATABASE_URL` from the connector's own name (above).
 *  - `BETTER_AUTH_URL` from the deployment's origin. Production is required to name its canonical
 *    domain, and does (the deploy script sets it), but a preview's URL exists only once that
 *    deployment does — and `NODE_ENV` is `production` on previews, so without this every preview
 *    fails the required-variable check at boot. Deriving it also gets the passkey relying-party id
 *    right for the host actually being visited, which one pinned URL cannot do for every preview.
 */
function withPlatformDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let out = source;
  if (!out.DATABASE_URL) {
    const alias = DATABASE_URL_ALIASES.find((name) => out[name]);
    if (alias) out = { ...out, DATABASE_URL: out[alias] };
  }
  if (!out.BETTER_AUTH_URL && out.VERCEL) {
    const host = out.VERCEL_ENV === 'production'
      ? (out.VERCEL_PROJECT_PRODUCTION_URL || out.VERCEL_URL)
      : out.VERCEL_URL;
    if (host) out = { ...out, BETTER_AUTH_URL: `https://${host}` };
  }
  return out;
}

function load(raw: NodeJS.ProcessEnv): ServerEnv {
  const source = withPlatformDefaults(raw);
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
   * A deployed app is never a test run (swarm K, finding 5).
   *
   * `NODE_ENV=test` opens the test-principal gate: two headers and a secret become any guest or any
   * admin. On a developer's machine or in CI that is the point; on a deployment it is a header away
   * from full authority, and every level since 06 has leaned harder on that injector. Refuse to
   * boot rather than serve. CI is deliberately NOT a marker — CI is exactly where NODE_ENV=test
   * belongs.
   */
  if (e.NODE_ENV === 'test' && (source.VERCEL || source.VERCEL_ENV)) {
    throw new Error('NODE_ENV=test is not allowed on a deployed app (VERCEL is set). Use development or production.');
  }

  if (isProduction && !isBuildPhase) {
    /**
     * RESEND_CONNECT_USER_ID and EMAIL_FROM are deliberately NOT here, though review S6 put them here.
     *
     * S6's property is that production must never route a one-time code to the in-memory dev
     * inbox, and `createAuthEmailProvider` is what enforces it: without a real mailer it THROWS
     * rather than returning the mock, so the failure is loud and lands on the one action that
     * needed email. That is the whole of the safety.
     *
     * Failing here instead made every route 500 — the home page, the schedule, the travel page,
     * `/api/health` — for want of a credential none of them uses. A site that cannot show a guest
     * the date of the wedding because it cannot send an e-mail is not failing safe, it is just
     * failing, and it is how this deployment spent its first hour.
     *
     * The cost is that a missing mailer is now discovered when a guest asks for a code rather
     * than at boot. `npm run deploy:vercel` narrows that gap from the other side: its preflight
     * refuses to deploy over anything in this list, and warns — without refusing — when the mailer
     * is absent, because a site that cannot send mail should still go up and show the date.
     * Nothing here makes RSVP work without it; the warning is so the gap is known, not guessed at.
     */
    const required: (keyof Parsed)[] = ['CONFIRMATION_SECRET', 'CRON_SECRET', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL'];
    const missing: string[] = required.filter((k) => !e[k]);
    // Storage must be S3 or a deliberately configured local-fs signing secret; the committed dev default is never used in production.
    if (!hasS3(e) && !e.STORAGE_SIGNING_SECRET && !e.DEV_STORAGE_SECRET) {
      missing.push('STORAGE_SIGNING_SECRET (or S3_ENDPOINT + S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY)');
    }
    // Vercel production must not silently run on ephemeral /tmp PGlite; previews may.
    if (source.VERCEL_ENV === 'production' && !e.DATABASE_URL) missing.push('DATABASE_URL (VERCEL_ENV=production)');
    if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    if (e.RATE_LIMIT_BACKEND === 'memory') throw new Error('RATE_LIMIT_BACKEND=memory is not allowed in production (per-process buckets are not a rate limit behind a load balancer)');
  }
  const TRUSTED_PROXY_HOPS = e.TRUSTED_PROXY_HOPS ?? (source.VERCEL ? 1 : 0);
  /**
   * With 0 hops every forwarding header is ignored — correctly, because nothing overwrites them —
   * so every client collapses to the single `direct` rate-limit bucket and one visitor can hold the
   * whole site's anonymous budget down. That is the right default when nothing is in front of the
   * app and the wrong one behind nginx or Cloudflare, so say it out loud rather than failing
   * quietly. The counterpart to the `getClientIp` fix at level 12: that one stops a caller MINTING
   * buckets, this one stops everyone SHARING one. console, not the logger: this runs at first
   * import, before anything is configured.
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
