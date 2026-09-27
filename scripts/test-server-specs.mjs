#!/usr/bin/env node
/**
 * `npm run test:e2e:server [-- <spec>…]`: the identity, RSVP and security Playwright specs, run the
 * way CI's "NODE_ENV=test server" step runs them.
 *
 * Those specs need a server that `npm run test:e2e` never starts: NODE_ENV=test for the dev inbox
 * and the test-principal injector, the fixture seed, and `TRUSTED_PROXY_HOPS=1` so each spec's
 * `x-forwarded-for` is its own rate-limit client. Without that last one every caller shares one
 * bucket, and otp.spec's "a second client keeps its own allowance" fails for a reason that has
 * nothing to do with the code under test.
 *
 * TEST_SERVER_ENV and WARM_ROUTES mirror the CI step (.github/workflows/design-quality.yml);
 * tests/unit/agent/test-server-specs.test.ts fails when the two drift. With no arguments this warms
 * every route and runs every TEST_SERVER_SPECS file, like CI. That warm-up peaks near 14 GB of
 * `next dev` (the CI step adds swap for it), so on a laptop name the specs you want: only the routes
 * those files mention, and the pages every journey passes through, are warmed first. Skipping the
 * warm-up altogether is not an option — a cold compile of `/` after sign-out outlasts claim.spec's
 * 5s `toHaveURL`, the flake the CI step's warm-up comment describes.
 *
 * The server starts on PORT (default 3100), and is stopped whatever happens. It never reaches a real
 * system: `next dev` loads `.env` too, so every credential and database setting there is blanked
 * (LOCAL_ISOLATION), which is what CI gets by having no `.env` at all.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_SERVER_SPECS } from './check-spec-coverage.mjs';
import { parseStat } from './clean.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every setting the CI step gives its server and runner, with local placeholders for its secrets. */
export function testServerEnv(port) {
  const origin = `http://localhost:${port}`;
  return {
    NODE_ENV: 'test',
    BASE_URL: origin,
    SEED_TEST_FIXTURES: '1',
    FLAG_RSVP_MEALS: 'on',
    DEV_INBOX_TOKEN: 'local-dev-inbox-token-not-real',
    TEST_AUTH_SECRET: 'local-test-auth-secret-not-real',
    MEDIA_PART_SIZE_MB: '1',
    MEDIA_MULTIPART_THRESHOLD_MB: '1',
    PGLITE_MEMORY: '1',
    DB_AUTO_MIGRATE: '1',
    DB_AUTO_SEED: '1',
    LOG_FORMAT: 'json',
    NEXT_PUBLIC_SITE_URL: origin,
    CONFIRMATION_SECRET: 'local-confirmation-secret-not-real',
    CRON_SECRET: 'local-cron-secret-not-real-32-chars-minimum',
    STORAGE_SIGNING_SECRET: 'local-storage-signing-secret-not-real',
    HEALTH_TOKEN: 'local-health-token-not-real',
    BETTER_AUTH_SECRET: 'local-better-auth-secret-not-real',
    BETTER_AUTH_URL: origin,
    TRUSTED_PROXY_HOPS: '1',
  };
}

/** Every path a spec navigates to, plus /api/session (the CI step says why each one is here). */
export const WARM_ROUTES = [
  '/', '/sign-in', '/sign-in/admin', '/admin', '/claim', '/claim/verify', '/claim/welcome', '/claim/passkey', '/step-up', '/rsvp', '/rsvp/attending', '/rsvp/meals',
  '/your-weekend', '/trip', '/transportation', '/gifts', '/photos', '/photos/guest-uploads',
  '/media/upload', '/media/mine', '/media/search', '/admin/ai',
  '/admin/lifecycle', '/admin/audit', '/admin/jobs', '/admin/metrics', '/admin/providers', '/admin/flags',
  '/admin/concierge', '/admin/content', '/admin/events', '/admin/gifts', '/admin/guests',
  '/admin/households', '/admin/invitations', '/admin/media', '/admin/reservations', '/admin/rsvp',
  '/admin/seating', '/admin/transport', '/admin/travel',
  '/admin/guests/export', '/admin/rsvp/export',
  '/admin/media/duplicates', '/admin/media/import', '/admin/media/metrics',
  '/ask-us', '/our-story', '/the-wedding', '/our-venue', '/share-an-adventure', '/sign-out',
  '/our-adventures', '/travel',
  '/invite/warmup-token-0000000000000000000000', '/api/dev/inbox', '/api/session',
  // The lifecycle preview route (`/t/[theme]/preview/[token]`): the masthead sweep reaches every
  // state through it, and nothing else on this server does. The proxy rewrites on the value's shape,
  // not on who asks, so an anonymous request compiles it.
  '/?preview=RSVP_OPEN',
];

/** Postgres URLs the server reads when DATABASE_URL is unset (src/lib/env.ts DATABASE_URL_ALIASES). */
export const DATABASE_URL_ALIASES = ['POSTGRES_URL', 'POSTGRES_PRISMA_URL'];

/** A setting that reaches a real system: a database, a mailbox, a bucket, a paid API, an admin list. */
export const CREDENTIAL = /^DATABASE_URL$|_KEY$|_SECRET$|_TOKEN$|_ID$|_CODES?$|^S3_ENDPOINT$|^S3_BUCKET$|^EMAIL_FROM$|^ADMIN_EMAILS$/;

/**
 * Every credential `.env.example` documents, and the database aliases, set to ''. Next never lets
 * `.env` override a variable already in the environment, even an empty one, and the server reads ''
 * as unset. Without this a developer's `.env` DATABASE_URL (the couple's real Postgres) wins over
 * PGLITE_MEMORY, and the fixture seed writes test guests and an owner admin into it; RESEND_* and
 * S3_* would send real mail and write real objects.
 */
export function localIsolation(exampleText, mirrored) {
  const documented = [...exampleText.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  const blank = [...new Set([...documented.filter((k) => CREDENTIAL.test(k)), ...DATABASE_URL_ALIASES])].filter((k) => !(k in mirrored));
  return Object.fromEntries(blank.map((k) => [k, '']));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pages sign-in journeys pass through or land on, whether or not a spec names them in quotes (specs
 * reach the invite page through a template string and assert `/admin` and `/rsvp` with regexes).
 */
const ALWAYS_WARM = ['/', '/api/session', '/api/dev/inbox', '/sign-in', '/sign-out', '/invite/warmup-token-0000000000000000000000', '/claim/verify', '/claim/welcome', '/admin', '/rsvp'];

/** The warm-up for a run of `specs`: everything for a full run, else what those files name. */
export function routesToWarm(specs, read = (f) => readFileSync(f, 'utf8')) {
  if (!specs.length) return WARM_ROUTES;
  const text = specs.map((f) => read(f)).join('\n');
  const named = WARM_ROUTES.filter((r) => new RegExp(`['"\`]${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=['"\`?#])`).test(text));
  return [...new Set([...ALWAYS_WARM, ...named])];
}

/** Any answer from `/api/health` on this origin: someone is serving it. */
async function answers(origin) {
  try {
    return (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) })).ok;
  } catch {
    return false;
  }
}

/**
 * Splits the arguments into spec targets (a file, `file:line`, or a directory of specs) and
 * Playwright's own options, which pass through as given. A value after an option (`-g name`) is not a
 * path, so it passes through too.
 */
export function splitArgs(args, exists = (p) => existsSync(path.resolve(ROOT, p))) {
  const specs = [];
  const passThrough = [];
  for (const arg of args) {
    const target = arg.replace(/(:\d+)+$/, '');
    if (!arg.startsWith('-') && (target.endsWith('.spec.ts') || exists(target))) specs.push(arg);
    else passThrough.push(arg);
  }
  return { specs, passThrough };
}

/** The spec files a target names: itself, or every `.spec.ts` under a directory. */
function specFiles(target) {
  const abs = path.resolve(ROOT, target.replace(/(:\d+)+$/, ''));
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs, { recursive: true }).filter((f) => String(f).endsWith('.spec.ts')).map((f) => path.join(abs, String(f)));
}

/** A process of the group is still running (a zombie has exited; it only waits to be reaped). */
function groupRunning(pgid) {
  if (!existsSync('/proc')) {
    try {
      process.kill(-pgid, 0);
      return true;
    } catch {
      return false;
    }
  }
  for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const { state, pgrp } = parseStat(readFileSync(`/proc/${pid}/stat`, 'utf8'));
      if (pgrp === pgid && state !== 'Z') return true;
    } catch {
      // gone
    }
  }
  return false;
}

async function main(args) {
  const { specs, passThrough } = splitArgs(args);
  const missing = specs.filter((s) => !existsSync(path.resolve(ROOT, s.replace(/(:\d+)+$/, ''))));
  if (missing.length) {
    console.error(`no such spec: ${missing.join(', ')}`);
    return 1;
  }
  const port = process.env.PORT ?? '3100';
  const mirrored = testServerEnv(port);
  const env = { ...process.env, ...localIsolation(readFileSync(path.join(ROOT, '.env.example'), 'utf8'), mirrored), ...mirrored };
  if (await answers(env.BASE_URL)) {
    console.error(`something is already serving ${env.BASE_URL}; stop it or run with another PORT`);
    return 1;
  }

  // Not under test-results/: Playwright empties that directory when it starts, log and all.
  const log = path.join(tmpdir(), `wedding-test-server-${port}.log`);
  const out = openSync(log, 'w'); // one descriptor for both streams, so neither overwrites the other
  // Its own process group, so stopping it takes `next dev`, next-server and the Turbopack workers too.
  const server = spawn('npx', ['next', 'dev', '-p', port], { cwd: ROOT, env, detached: true, stdio: ['ignore', out, out] });
  closeSync(out);
  let serverError;
  let serverExited = false;
  server.on('error', (e) => (serverError = e));
  server.on('exit', () => (serverExited = true));

  // Ctrl-C reaches Playwright directly (it shares our terminal's process group); here it only stops
  // the warm-up and sets the exit code. The server is stopped in `finally`, once, whatever happened.
  let interrupted = false;
  process.on('SIGINT', () => (interrupted = true));

  const stop = async () => {
    if (!server.pid) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      return; // the whole group is gone
    }
    // Wait for the group to exit, so the next command meets neither a server flushing `.next` nor a busy port.
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(200)) if (!groupRunning(server.pid)) return;
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // exited in between
    }
  };

  try {
    let up = false;
    for (const deadline = Date.now() + 180_000; !up && !serverExited && !serverError && !interrupted && Date.now() < deadline; ) {
      up = await answers(env.BASE_URL);
      if (!up) await sleep(2000);
    }
    if (interrupted) return 130;
    if (!up) {
      console.error(`test server ${serverError ? `could not start (${serverError.message})` : serverExited ? 'exited' : 'did not become ready'}; the end of ${log}:`);
      // The reason is usually in the last lines: a port in use, or Next refusing a second dev server here.
      console.error(readFileSync(log, 'utf8').trimEnd().split('\n').slice(-12).join('\n'));
      return 1;
    }
    const warm = routesToWarm(specs.flatMap(specFiles));
    console.log(`warming ${warm.length} route${warm.length === 1 ? '' : 's'}${specs.length ? '' : ' (a full run peaks near 14 GB; name spec files to warm only theirs)'}`);
    for (const route of warm) {
      if (interrupted) return 130;
      await fetch(`${env.BASE_URL}${route}`, { signal: AbortSignal.timeout(120_000) }).catch(() => {});
    }
    const playwright = spawn('npx', ['playwright', 'test', ...(specs.length ? specs : TEST_SERVER_SPECS), ...passThrough], { cwd: ROOT, env, stdio: 'inherit' });
    const status = await new Promise((resolve) => {
      playwright.on('error', () => resolve(1));
      playwright.on('exit', (code) => resolve(code ?? 1));
    });
    return interrupted ? 130 : status;
  } finally {
    await stop();
  }
}

// Node resolves symlinks in the main module's URL but not in argv[1], so compare real paths.
const runDirectly = () => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (runDirectly()) {
  process.exitCode = await main(process.argv.slice(2));
}
