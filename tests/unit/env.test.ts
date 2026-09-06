import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/lib/env';

describe('server env', () => {
  it('applies defaults and treats every provider variable as optional', () => {
    const e = parseServerEnv({ NODE_ENV: 'test' });
    expect(e.isTest).toBe(true);
    expect(e.DATABASE_URL).toBeUndefined();
    expect(e.JOBS_POLL_INTERVAL_MS).toBe(2000);
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
    expect(() => parseServerEnv({ ...prodBase, RESEND_API_KEY: '', EMAIL_FROM: '' })).toThrow(/RESEND_API_KEY/);
    const e = parseServerEnv({ ...prodBase, STORAGE_SIGNING_SECRET: 's'.repeat(32) });
    expect(e.isProduction).toBe(true);
  });

  it('requires S3 or an explicit storage signing secret in production (names only)', () => {
    expect(() => parseServerEnv(prodBase)).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(() => parseServerEnv({ ...prodBase, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' })).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(parseServerEnv({ ...prodBase, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 'value-must-not-leak' }).isProduction).toBe(true);
    // DEV_STORAGE_SECRET (written by the secrets autofill) is accepted as the signing secret.
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
    expect(parseServerEnv({ NODE_ENV: 'test' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(parseServerEnv({ NODE_ENV: 'test', VERCEL: '1' }).TRUSTED_PROXY_HOPS).toBe(1);
    expect(parseServerEnv({ NODE_ENV: 'test', VERCEL: '1', TRUSTED_PROXY_HOPS: '2' }).TRUSTED_PROXY_HOPS).toBe(2);
    expect(parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: '0' }).TRUSTED_PROXY_HOPS).toBe(0);
    expect(() => parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: '-1' })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(() => parseServerEnv({ NODE_ENV: 'test', TRUSTED_PROXY_HOPS: 'many' })).toThrow(/TRUSTED_PROXY_HOPS/);
  });

  it('parses booleans and integers from strings', () => {
    const e = parseServerEnv({ NODE_ENV: 'test', FORCE_MOCK_PROVIDERS: 'yes', JOBS_INLINE_RUNNER: '0', JOBS_BATCH_SIZE: '25' });
    expect(e.FORCE_MOCK_PROVIDERS).toBe(true);
    expect(e.JOBS_INLINE_RUNNER).toBe(false);
    expect(e.JOBS_BATCH_SIZE).toBe(25);
  });
});
