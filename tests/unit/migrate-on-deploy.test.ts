import { describe, expect, it } from 'vitest';
import { decide } from '../../scripts/deploy/migrate-on-deploy.mjs';

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
    for (const target of ['preview', 'development', 'unknown']) {
      const d = decide({ VERCEL: '1', VERCEL_ENV: target, POSTGRES_URL: 'postgres://live/db' });
      expect(d.run, `VERCEL_ENV=${target} must not migrate`).toBe(false);
      expect(d.reason).toContain(target);
    }
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

  it('skips rather than guesses when the build has no database URL', () => {
    // Mutation: return run:true with url undefined — `npm run db:migrate` would then fall
    // through to PGlite and "succeed" against a throwaway file.
    const d = decide(PROD);
    expect(d.run).toBe(false);
    expect(d.reason).toMatch(/no database URL/);
  });
});
