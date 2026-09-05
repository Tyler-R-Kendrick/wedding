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

  it('requires the signing secrets in production', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'production' })).toThrow(/CONFIRMATION_SECRET/);
    const e = parseServerEnv({ NODE_ENV: 'production', CONFIRMATION_SECRET: 'x'.repeat(32), CRON_SECRET: 'y'.repeat(32) });
    expect(e.isProduction).toBe(true);
  });

  it('parses booleans and integers from strings', () => {
    const e = parseServerEnv({ NODE_ENV: 'test', FORCE_MOCK_PROVIDERS: 'yes', JOBS_INLINE_RUNNER: '0', JOBS_BATCH_SIZE: '25' });
    expect(e.FORCE_MOCK_PROVIDERS).toBe(true);
    expect(e.JOBS_INLINE_RUNNER).toBe(false);
    expect(e.JOBS_BATCH_SIZE).toBe(25);
  });
});
