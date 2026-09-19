import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATABASE_URL_ALIASES } from '@/lib/env';
import { decide } from '../../scripts/deploy/migrate-on-deploy.mjs';

const SCRIPT = path.resolve(process.cwd(), 'scripts/deploy/migrate-on-deploy.mjs');

/** Run the script as the build would, with a clean env. Never given a URL, so it never migrates. */
function runScript(env: Record<string, string>): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      env: { NODE_ENV: 'production', PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * The build step that replaces `DB_AUTO_MIGRATE` in production. Each case below is written
 * against the mutation that should turn it red, because a migration step that silently does
 * nothing is indistinguishable from one that worked until the site answers 500 on every route.
 */
describe('migrate-on-deploy', () => {
  const PROD = { VERCEL: '1', VERCEL_ENV: 'production' };

  it('migrates on a production Vercel build', () => {
    // Mutation: `run: false` here, or dropping the POSTGRES_URL fallback.
    const d = decide({ ...PROD, POSTGRES_URL: 'postgres://u:p@h:6543/app' });
    expect(d.run).toBe(true);
    expect(d.url).toBe('postgres://u:p@h:6543/app');
  });

  it('never migrates from a preview build, which shares the production connector URLs', () => {
    // The connector writes POSTGRES_* to all three targets with the same value, so this is the
    // case that would apply an unreviewed chain to the live database.
    // Mutation: drop the VERCEL_ENV check.
    for (const target of ['preview', 'development']) {
      const d = decide({ VERCEL: '1', VERCEL_ENV: target, POSTGRES_URL: 'postgres://live/db' });
      expect(d.run, `VERCEL_ENV=${target} must not migrate`).toBe(false);
      expect(d.reason).toContain(target);
    }
  });

  it('does not migrate when VERCEL_ENV is absent, rather than treating unknown as production', () => {
    // Mutation: `(env.VERCEL_ENV ?? 'production') !== 'production'`. A Vercel build that stopped
    // exposing VERCEL_ENV would then migrate from every environment at once.
    const d = decide({ VERCEL: '1', POSTGRES_URL: 'postgres://live/db' });
    expect(d.run).toBe(false);
    expect(d.fatal).toBeFalsy();
  });

  it('does nothing off Vercel, so a local build never touches whatever is in the shell', () => {
    // Mutation: drop the `env.VERCEL` guard — a developer's `next build` would then migrate
    // whichever database DATABASE_URL happened to name.
    const d = decide({ VERCEL_ENV: 'production', DATABASE_URL: 'postgres://someones/db' });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('not a Vercel build');
  });

  it('prefers the direct connection over the pooled one for DDL', () => {
    // Migrations are DDL in transactions; a transaction-mode pooler serves those across
    // connections and fails mid-chain. Mutation: reorder the fallback chain.
    const d = decide({ ...PROD, POSTGRES_URL: 'postgres://u:p@h.pooler.supabase.com:6543/app', POSTGRES_URL_NON_POOLING: 'postgres://u:p@db.h.supabase.co:5432/app' });
    expect(d.url).toBe('postgres://u:p@db.h.supabase.co:5432/app');
  });

  it('lets an explicit DATABASE_URL win, exactly as src/lib/env.ts does', () => {
    // Mutation: put DATABASE_URL last in the chain, and the app and the migrator would
    // disagree about which database they are talking to.
    const d = decide({ ...PROD, DATABASE_URL: 'postgres://mine/db', POSTGRES_URL_NON_POOLING: 'postgres://theirs/db' });
    expect(d.url).toBe('postgres://mine/db');
  });

  it('handles every alias the app itself resolves a database from', () => {
    // decide()'s chain is deliberately not a copy of DATABASE_URL_ALIASES — it adds
    // POSTGRES_URL_NON_POOLING, which the app has no use for. But it must not be a SUBSET:
    // an alias the app would boot from and this step ignores is a deploy that migrates
    // nothing and then serves from a database it never touched.
    // Mutation: delete a name from decide()'s chain.
    for (const alias of DATABASE_URL_ALIASES) {
      const d = decide({ ...PROD, [alias]: `postgres://u:p@h/${alias}` });
      expect(d.run, `${alias} is an app alias but decide() ignores it`).toBe(true);
      expect(d.url).toBe(`postgres://u:p@h/${alias}`);
    }
  });

  it('fails the build when a production build has no database URL', () => {
    // env.ts refuses to boot production on Vercel without a database, so skipping quietly would
    // ship a deployment that could only answer 500 — with a green build to say it went fine.
    // Mutation: return plain `run:false` and let the build continue.
    const d = decide(PROD);
    expect(d.run).toBe(false);
    expect(d.fatal).toBe(true);
    expect(d.reason).toMatch(/no database URL/);
  });

  describe('the runner, not just the decision', () => {
    it('actually executes: the isMain guard fires and the skip is reported', () => {
      // Mutation: break isMain (e.g. back to `file://${process.argv[1]}` under a path needing
      // encoding). The script would produce no output at all and still exit 0 — the silent
      // no-op this whole step exists to avoid.
      const { status, out } = runScript({ VERCEL: '1', VERCEL_ENV: 'preview' });
      expect(status).toBe(0);
      expect(out).toContain('migrate-on-deploy: skipped (VERCEL_ENV=preview)');
    });

    it('exits non-zero on a production build with no database URL', () => {
      // Mutation: exit 0 on the fatal path.
      const { status, out } = runScript({ VERCEL: '1', VERCEL_ENV: 'production' });
      expect(status).toBe(1);
      expect(out).toMatch(/no database URL/);
    });
  });
});
