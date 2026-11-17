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
 * The server is the production build (`next build`, then `next start`) started with NODE_ENV=test.
 * Every gate these specs depend on reads the environment when the server starts (src/lib/env.ts),
 * so the compiled code is the code that ships and only the settings differ. It used to be
 * `next dev`: that compiled each route on its first request, so the script requested eighty routes
 * before the first spec, paced by the compiler's memory, and the server still grew to 9 GB over a
 * run. The 30 specs took 22 minutes at the median in CI (150 runs to 2026-11-16) against 9 on the
 * build, on the same four cores, with no warm-up and no retries.
 *
 * The CI step (.github/workflows/design-quality.yml) runs this script, so there is one set of
 * server settings (tests/unit/agent/test-server-specs.test.ts). With no arguments it runs every
 * TEST_SERVER_SPECS file; name spec files to run only those.
 *
 * It builds first, so a run never tests a build older than the checkout. `--no-build` skips that
 * for a caller that has just built (each CI shard builds, then runs its tests through this script).
 *
 * The server starts on PORT (default 3100), and is stopped whatever happens. It never reaches a real
 * system: `next start` loads `.env` too, so every credential and database setting there is blanked
 * (LOCAL_ISOLATION), which is what CI gets by having no `.env` at all.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
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

/**
 * The server keeps an idle connection open for two minutes, not Node's five seconds.
 *
 * Playwright's request client keeps connections and reuses them. A server that closes one after
 * 5 s idle (measured: `Keep-Alive: timeout=5`, closed at 6.3 s) and a test that reuses it at that
 * moment meet as `read ECONNRESET` on a request that never reached any code: idor.spec.ts failed
 * that way on its first POST, and webmcp.spec.ts had a retry for exactly this error. A browser
 * opens a new connection when that happens; a test client sending a POST does not.
 */
export const KEEP_ALIVE = ['--keepAliveTimeout', '120000'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Runs a command to completion with this terminal's streams; resolves with its exit code. */
function run(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main(args) {
  const build = !args.includes('--no-build');
  const { specs, passThrough } = splitArgs(args.filter((a) => a !== '--no-build'));
  const missing = specs.filter((s) => !existsSync(path.resolve(ROOT, s.replace(/(:\d+)+$/, ''))));
  if (missing.length) {
    console.error(`no such spec: ${missing.join(', ')}`);
    return 1;
  }
  const port = process.env.PORT ?? '3100';
  const mirrored = testServerEnv(port);
  const isolation = localIsolation(readFileSync(path.join(ROOT, '.env.example'), 'utf8'), mirrored);
  const env = { ...process.env, ...isolation, ...mirrored };
  if (await answers(env.BASE_URL)) {
    console.error(`something is already serving ${env.BASE_URL}; stop it or run with another PORT`);
    return 1;
  }

  if (build) {
    // A production build, so not NODE_ENV=test: only the server that serves it runs in test mode.
    const { NODE_ENV: _mode, ...buildEnv } = { ...process.env, ...isolation, PGLITE_MEMORY: '1' };
    const status = await run('npm', ['run', '-s', 'build'], buildEnv);
    if (status !== 0) return status;
  } else if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    console.error('--no-build was given and there is no production build in .next; run `npm run build` first');
    return 1;
  }

  // Not under test-results/: Playwright empties that directory when it starts, log and all.
  const log = path.join(tmpdir(), `wedding-test-server-${port}.log`);
  const out = openSync(log, 'w'); // one descriptor for both streams, so neither overwrites the other
  // Its own process group, so stopping it takes `next start` and next-server together.
  const server = spawn('npx', ['next', 'start', '-p', port, ...KEEP_ALIVE], { cwd: ROOT, env, detached: true, stdio: ['ignore', out, out] });
  closeSync(out);
  let serverError;
  let serverExited = false;
  server.on('error', (e) => (serverError = e));
  server.on('exit', () => (serverExited = true));

  // Ctrl-C reaches Playwright directly (it shares our terminal's process group); here it only sets
  // the exit code. The server is stopped in `finally`, once, whatever happened.
  let interrupted = false;
  process.on('SIGINT', () => (interrupted = true));

  const stop = async () => {
    if (!server.pid) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      return; // the whole group is gone
    }
    // Wait for the group to exit, so the next command does not meet a busy port.
    for (const deadline = Date.now() + 10_000; Date.now() < deadline; await sleep(200)) if (!groupRunning(server.pid)) return;
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {
      // exited in between
    }
  };

  try {
    let up = false;
    for (const deadline = Date.now() + 60_000; !up && !serverExited && !serverError && !interrupted && Date.now() < deadline; ) {
      up = await answers(env.BASE_URL);
      if (!up) await sleep(250);
    }
    if (interrupted) return 130;
    if (!up) {
      console.error(`test server ${serverError ? `could not start (${serverError.message})` : serverExited ? 'exited' : 'did not become ready'}; the end of ${log}:`);
      // The reason is usually in the last lines: a port in use, or a setting the server refused at boot.
      console.error(readFileSync(log, 'utf8').trimEnd().split('\n').slice(-12).join('\n'));
      return 1;
    }
    const status = await run('npx', ['playwright', 'test', ...(specs.length ? specs : TEST_SERVER_SPECS), ...passThrough], env);
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
