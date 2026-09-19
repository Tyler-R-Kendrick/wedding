#!/usr/bin/env node
/**
 * Applies the committed migration chain once per production deploy, from the build step.
 *
 * The alternative is `DB_AUTO_MIGRATE=1`, which `src/db/client.ts` runs inside `connect()` — that
 * is once per *serverless instance*, so on Vercel the migrator and the seed run on every cold
 * start, while someone is reading the site. `docs/ops/deploy-vercel-supabase.md` says to leave
 * that flag off in production and migrate during the deploy instead; this is that deploy step.
 *
 * Exported separately from the runner so the decision is unit-testable without a database.
 */
import { spawnSync } from 'node:child_process';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ run: boolean, reason: string, url?: string }}
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
  const url = env.DATABASE_URL || env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL;
  if (!url) return { run: false, reason: 'no database URL in the build environment' };

  return { run: true, reason: 'production deploy', url };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { run, reason, url } = decide(process.env);
  if (!run) {
    console.log(`migrate-on-deploy: skipped (${reason})`);
    process.exit(0);
  }
  console.log('migrate-on-deploy: applying the migration chain before the build');
  // Fail the build rather than ship code onto a database that does not have its schema: that
  // combination is what answered 500 on every route the first time this site went up.
  const r = spawnSync('npm', ['run', 'db:migrate'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
  if (r.status !== 0) console.error('migrate-on-deploy: migrations failed; failing the build');
  process.exit(r.status ?? 1);
}
