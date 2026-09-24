import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/lib/env';

describe('server env', () => {
  it('applies defaults and treats every provider variable as optional', () => {
    const e = parseServerEnv({ NODE_ENV: 'test' });
    expect(e.isTest).toBe(true);
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.JOBS_BATCH_SIZE).toBe(10);
    expect(e.TRANSPORT_BENEFIT_MODE).toBe('mock');
    expect(e.PGLITE_MEMORY).toBe(false);
  });

  it('fails fast on malformed values without echoing them', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'test', DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
    expect(() => parseServerEnv({ NODE_ENV: 'test', CONFIRMATION_SECRET: 'short' })).toThrow(/CONFIRMATION_SECRET/);
    expect(() => parseServerEnv({ NODE_ENV: 'test', JOBS_BATCH_SIZE: 'lots' })).toThrow(/JOBS_BATCH_SIZE/);
    try {
      parseServerEnv({ NODE_ENV: 'test', S3_ENDPOINT: 'nope-secret-value' });
    } catch (e) {
      expect((e as Error).message).not.toContain('nope-secret-value');
    }
  });

  const prodBase = { NODE_ENV: 'production', CONFIRMATION_SECRET: 'x'.repeat(32), CRON_SECRET: 'y'.repeat(32), BETTER_AUTH_SECRET: 'z'.repeat(32), BETTER_AUTH_URL: 'https://example.test', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Sara + Tyler <hello@example.test>' };

  it('requires the signing secrets in production', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'production' })).toThrow(/CONFIRMATION_SECRET/);
    expect(() => parseServerEnv({ NODE_ENV: 'production', CONFIRMATION_SECRET: 'x'.repeat(32), CRON_SECRET: 'y'.repeat(32) })).toThrow(/BETTER_AUTH_SECRET/);
    const e = parseServerEnv({ ...prodBase, STORAGE_SIGNING_SECRET: 's'.repeat(32) });
    expect(e.isProduction).toBe(true);
  });

  it('boots production without a mailer, because no page needs one to render', () => {
    // This used to throw on RESEND_API_KEY, which took the home page, the schedule, the travel
    // page and /api/health down for want of a credential none of them uses — a deployed site
    // answering 500 everywhere because it could not send an e-mail. `createAuthEmailProvider`
    // is what holds review S6's line, and the test below is that line.
    const e = parseServerEnv({ ...prodBase, RESEND_API_KEY: '', EMAIL_FROM: '', STORAGE_SIGNING_SECRET: 's'.repeat(32) });
    expect(e.isProduction).toBe(true);
    expect(e.RESEND_API_KEY).toBeUndefined();
  });

  it('requires S3 or an explicit storage signing secret in production (names only)', () => {
    expect(() => parseServerEnv(prodBase)).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(() => parseServerEnv({ ...prodBase, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' })).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(parseServerEnv({ ...prodBase, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 'value-must-not-leak' }).isProduction).toBe(true);
    // DEV_STORAGE_SECRET (an older name for STORAGE_SIGNING_SECRET) is accepted as the signing secret.
    expect(parseServerEnv({ ...prodBase, DEV_STORAGE_SECRET: 'd'.repeat(32) }).isProduction).toBe(true);
    try {
      parseServerEnv({ ...prodBase, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' });
    } catch (e) {
      expect((e as Error).message).not.toContain('value');
    }
    // `next build` has no runtime secrets; the check runs when the server starts.
    expect(parseServerEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }).isProduction).toBe(true);
  });

  it('refuses Vercel production without DATABASE_URL but allows previews', () => {
    const prod = { ...prodBase, STORAGE_SIGNING_SECRET: 's'.repeat(32), VERCEL: '1' };
    expect(() => parseServerEnv({ ...prod, VERCEL_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(parseServerEnv({ ...prod, VERCEL_ENV: 'preview' }).DATABASE_URL).toBeUndefined();
    expect(parseServerEnv({ ...prod, VERCEL_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/db' }).DATABASE_URL).toBeDefined();
  });

  it('requires a 32+ char CRON_SECRET and refuses the memory rate limiter in production', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'test', CRON_SECRET: 'c'.repeat(20) })).toThrow(/CRON_SECRET/);
    const prod = { ...prodBase, STORAGE_SIGNING_SECRET: 's'.repeat(32) };
    expect(() => parseServerEnv({ ...prod, RATE_LIMIT_BACKEND: 'memory' })).toThrow(/RATE_LIMIT_BACKEND/);
    expect(parseServerEnv({ ...prod, RATE_LIMIT_BACKEND: 'db' }).RATE_LIMIT_BACKEND).toBe('db');
    expect(parseServerEnv({ NODE_ENV: 'test', RATE_LIMIT_BACKEND: 'memory' }).RATE_LIMIT_BACKEND).toBe('memory');
  });

  it('resolves TRUSTED_PROXY_HOPS: explicit value, else 1 on Vercel, else 0', () => {
    // The Vercel cases run as `development`, not `test`: level 13 refuses to boot with
    // NODE_ENV=test alongside a deploy marker (that combination opens the test-principal gate on a
    // deployment), so the pairing this test used to express is now impossible by design. The
    // subject here is the hop arithmetic, not the environment name.
    expect(parseServerEnv({ NODE_ENV: 'test' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(parseServerEnv({ NODE_ENV: 'development', VERCEL: '1' }).TRUSTED_PROXY_HOPS).toBe(1);
    expect(parseServerEnv({ NODE_ENV: 'development', VERCEL: '1', TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS).toBe(2);
    expect(parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(() => parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: '-1' })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(() => parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: 'many' })).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  it('parses booleans and integers from strings', () => {
    const e = parseServerEnv({ NODE_ENV: 'test', FORCE_MOCK_PROVIDERS: 'yes', S3_FORCE_PATH_STYLE: '0', JOBS_BATCH_SIZE: '25' });
    expect(e.FORCE_MOCK_PROVIDERS).toBe(true);
    expect(e.S3_FORCE_PATH_STYLE).toBe(false);
    expect(e.JOBS_BATCH_SIZE).toBe(25);
  });
});

describe('what the platform already knows', () => {
  const prodBase = { NODE_ENV: 'production', CONFIRMATION_SECRET: 'x'.repeat(32), CRON_SECRET: 'y'.repeat(32), BETTER_AUTH_SECRET: 'z'.repeat(32), RESEND_API_KEY: 're_test', EMAIL_FROM: 'Sara + Tyler <hello@example.test>', STORAGE_SIGNING_SECRET: 's'.repeat(32) };

  it('reads the Vercel connector\'s own name for the database', () => {
    // `vercel integration add supabase` writes POSTGRES_URL, never DATABASE_URL, and one project
    // variable cannot reference another — so without this the connector provisions a database the
    // app never opens.
    expect(parseServerEnv({ NODE_ENV: 'test', POSTGRES_URL: 'postgres://u:p@db.example.test:6543/app' }).DATABASE_URL)
      .toBe('postgres://u:p@db.example.test:6543/app');
    expect(parseServerEnv({ NODE_ENV: 'test', POSTGRES_PRISMA_URL: 'postgres://u:p@db.example.test:6543/app?pgbouncer=true' }).DATABASE_URL)
      .toBe('postgres://u:p@db.example.test:6543/app?pgbouncer=true');
  });

  it('lets an explicit DATABASE_URL win over the connector\'s name', () => {
    const e = parseServerEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://mine@host.example.test/app', POSTGRES_URL: 'postgres://theirs@host.example.test/app' });
    expect(e.DATABASE_URL).toBe('postgres://mine@host.example.test/app');
  });

  it('derives BETTER_AUTH_URL from a preview deployment, which is the only thing that knows its own host', () => {
    // NODE_ENV is production on a Vercel preview, so the required-variable check applies there too;
    // a project-wide URL would also pin every preview's passkey relying party to another host.
    const e = parseServerEnv({ ...prodBase, VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_URL: 'wedding-git-branch.vercel.app' });
    expect(e.BETTER_AUTH_URL).toBe('https://wedding-git-branch.vercel.app');
  });

  it('prefers the canonical domain in production, and an explicit value over both', () => {
    // VERCEL_ENV=production also demands a real database; that guard is asserted above.
    const onProd = { ...prodBase, DATABASE_URL: 'postgres://u:p@db.example.test:6543/app', VERCEL: '1', VERCEL_ENV: 'production' };
    const derived = parseServerEnv({ ...onProd, VERCEL_URL: 'wedding-abc123.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'sara-and-tyler.example' });
    expect(derived.BETTER_AUTH_URL).toBe('https://sara-and-tyler.example');
    const explicit = parseServerEnv({ ...onProd, BETTER_AUTH_URL: 'https://chosen.example', VERCEL_PROJECT_PRODUCTION_URL: 'sara-and-tyler.example' });
    expect(explicit.BETTER_AUTH_URL).toBe('https://chosen.example');
  });

  it('derives nothing off Vercel, so production elsewhere still has to say its own origin', () => {
    expect(() => parseServerEnv({ ...prodBase, VERCEL_URL: 'wedding.vercel.app' })).toThrow(/BETTER_AUTH_URL/);
  });
});
