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
 * The server starts on PORT (default 3100), and is stopped whatever happens.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEST_SERVER_SPECS } from './check-spec-coverage.mjs';

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
];

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

async function ready(origin) {
  for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(2000)) {
    try {
      if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) })).ok) return true;
    } catch {
      // not listening yet
    }
  }
  return false;
}

/** Spec files pick what runs and what is warmed; every other argument goes to Playwright as is. */
async function main(args) {
  const specs = args.filter((a) => a.endsWith('.spec.ts'));
  const passThrough = args.filter((a) => !a.endsWith('.spec.ts'));
  const port = process.env.PORT ?? '3100';
  const env = { ...process.env, ...testServerEnv(port) };
  const logDir = path.join(ROOT, 'test-results');
  mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, 'test-server.log');
  // Its own process group, so stopping it takes `next dev`, next-server and the Turbopack workers too.
  const server = spawn('npx', ['next', 'dev', '-p', port], { cwd: ROOT, env, detached: true, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] });
  const signal = (sig) => {
    try {
      process.kill(-server.pid, sig);
      return true;
    } catch {
      return false; // the whole group is gone
    }
  };
  // Waits for the group to empty (SIGKILL after 10s), so the next command does not meet a server
  // still flushing `.next` or holding the port.
  const stop = async () => {
    if (!signal('SIGTERM')) return;
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(200)) if (!signal(0)) return;
    signal('SIGKILL');
  };
  process.on('SIGINT', () => void stop().then(() => process.exit(130)));
  try {
    if (!(await ready(env.BASE_URL))) {
      console.error(`test server did not become ready on ${env.BASE_URL}; see ${path.relative(ROOT, log)}`);
      return 1;
    }
    const missing = specs.filter((f) => !existsSync(path.resolve(ROOT, f)));
    if (missing.length) {
      console.error(`no such spec: ${missing.join(', ')}`);
      return 1;
    }
    const warm = routesToWarm(specs.map((f) => path.resolve(ROOT, f)));
    console.log(`warming ${warm.length} route${warm.length === 1 ? '' : 's'}${specs.length ? '' : ' (a full run peaks near 14 GB; name spec files to warm only theirs)'}`);
    for (const route of warm) await fetch(`${env.BASE_URL}${route}`, { signal: AbortSignal.timeout(120_000) }).catch(() => {});
    const run = spawnSync('npx', ['playwright', 'test', ...(specs.length ? specs : TEST_SERVER_SPECS), ...passThrough], { cwd: ROOT, env, stdio: 'inherit' });
    return run.status ?? 1;
  } finally {
    await stop();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
