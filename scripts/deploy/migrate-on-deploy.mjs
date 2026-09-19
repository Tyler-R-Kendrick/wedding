#!/usr/bin/env node
/**
 * Applies the committed migration chain once per production deploy, from the build step.
 *
 * The alternative is `DB_AUTO_MIGRATE=1`, which `src/db/client.ts` runs inside `connect()` — that
 * is once per *serverless instance*, so on Vercel the migrator and the seed run on every cold
 * start, while someone is reading the site. `docs/ops/deploy-vercel-supabase.md` says to leave
 * that flag off in production and migrate during the deploy instead; this is that deploy step.
 *
 * Ordering note: this runs BEFORE `next build`, so a build that fails afterwards leaves the
 * schema ahead of the code still serving. That is the deliberate trade: this app prerenders
 * pages that read content tables, so a build running against the *old* schema is the more
 * likely breakage of the two, and the chain here is additive by convention. A destructive
 * migration is the case to hand-roll — see the runbook.
 *
 * A second, deliberate consequence: `db:migrate` imports src/lib/env.ts in a process that is not
 * `next build`, so NEXT_PHASE is unset, `isBuildPhase` is false, and the full production guard
 * runs here — demanding CONFIRMATION_SECRET, CRON_SECRET, BETTER_AUTH_SECRET, BETTER_AUTH_URL and a
 * storage credential that the migrator itself never touches. That reads like over-coupling, and it
 * is kept anyway, because the alternative is worse: suppress the guard and an incomplete
 * environment builds green, deploys, and answers 500 on every route. Failing the build instead
 * leaves the previous deployment serving. Loud, early, and with the site still up.
 *
 * `decide` is exported separately from the runner so it is unit-testable without a database.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string, url?: string, fatal?: boolean }}
 */
export function decide(env = {}) {
  // Off Vercel this is not the migration path at all: `npm run db:migrate` is run directly, and a
  // local `next build` must never reach for whatever database happens to be in the shell.
  if (!env.VERCEL) return { run: false, reason: 'not a Vercel build' };

  // The Supabase connector writes POSTGRES_* to production, preview AND development with the same
  // value, so a preview build that migrated would apply an unreviewed chain to the live database.
  const target = env.VERCEL_ENV ?? 'unknown';
  if (target !== 'production') return { run: false, reason: `VERCEL_ENV=${target}` };

  // An explicit DATABASE_URL wins, exactly as it does in `src/lib/env.ts`. Among the names the
  // connector picks for us, prefer the direct one: DDL through a transaction-mode pooler is the
  // documented way to get "prepared statement does not exist" halfway through a migration
  // (see `usesTransactionPooler` in src/db/client.ts and tests/unit/db-pooler.test.ts).
  // What the APP will resolve at runtime: DATABASE_URL, or DATABASE_URL_ALIASES in src/lib/env.ts
  // (POSTGRES_URL, POSTGRES_PRISMA_URL). POSTGRES_URL_NON_POOLING is deliberately NOT among them.
  // Checking this separately is the difference between migrating a database and migrating one the
  // app can actually open: with only the non-pooling name set, the chain would apply cleanly and
  // every route would still 500, behind a green build.
  const appUrl = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;

  // Fail closed. A production build with no database the app can reach cannot produce a deployment
  // that serves: `src/lib/env.ts` refuses to boot production on Vercel without one, so every route
  // would 500. Skipping quietly here would ship exactly that, with a green build to say it went fine.
  if (!appUrl) {
    const near = env.POSTGRES_URL_NON_POOLING ? ' (POSTGRES_URL_NON_POOLING is set, but the app does not read it)' : '';
    return { run: false, fatal: true, reason: `production build has no database URL the app can read: DATABASE_URL, POSTGRES_URL or POSTGRES_PRISMA_URL${near}` };
  }

  // The migrator, though, prefers the direct connection where one exists.
  const url = env.DATABASE_URL || env.POSTGRES_URL_NON_POOLING || appUrl;

  return { run: true, reason: 'production deploy', url };
}

/**
 * The environment the migrator runs in.
 *
 * DB_AUTO_MIGRATE and DB_AUTO_SEED are pinned off rather than inherited: `db:migrate` opens the
 * database through `connect()` (src/db/client.ts), which runs its own migrate-and-seed when those
 * are on. Inherited, this step would either migrate twice or quietly seed a production database,
 * decided three modules away from here.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} url
 * @returns {Record<string, string | undefined>}
 */
export function childEnv(env, url) {
  return { ...env, DATABASE_URL: url, DB_AUTO_MIGRATE: '0', DB_AUTO_SEED: '0' };
}

// `pathToFileURL` rather than `file://` + argv[1]: the concatenated form does not percent-encode,
// so a checkout path with a space or a non-ASCII character makes this false and the script a
// silent no-op that migrates nothing and still exits 0. src/db/migrate.ts uses the same idiom.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { run, reason, url, fatal } = decide(process.env);
  if (fatal) {
    console.error(`migrate-on-deploy: ${reason}`);
    console.error('migrate-on-deploy: refusing to build a deployment that could only answer 500');
    process.exit(1);
  }
  if (!run) {
    console.log(`migrate-on-deploy: skipped (${reason})`);
    process.exit(0);
  }
  console.log('migrate-on-deploy: applying the migration chain before the build');
  // Fail the build rather than ship code onto a database that does not have its schema: that
  // combination is what answered 500 on every route the first time this site went up.
  const r = spawnSync('npm', ['run', 'db:migrate'], { stdio: 'inherit', env: childEnv(process.env, url) });
  if (r.status !== 0) console.error('migrate-on-deploy: migrations failed; failing the build');
  process.exit(r.status ?? 1);
}
