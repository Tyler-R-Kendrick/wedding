import { describe, expect, it } from 'vitest';
import { canonicalJson, hmacSha256, randomNumericCode, randomToken, stableHash, timingSafeEqualString } from '@/lib/crypto';
import { getClientIp, getRequestId } from '@/lib/request';
import { backoffDelayMs } from '@/lib/jobs/queue';

describe('crypto helpers', () => {
  it('hashes canonically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] }, u: undefined })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
  it('signs and compares in constant time', () => {
    const sig = hmacSha256('secret', 'data');
    expect(timingSafeEqualString(sig, hmacSha256('secret', 'data'))).toBe(true);
    expect(timingSafeEqualString(sig, hmacSha256('other', 'data'))).toBe(false);
    expect(timingSafeEqualString('a', 'ab')).toBe(false);
  });
  it('produces random tokens and numeric codes of the right shape', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(new Set(Array.from({ length: 50 }, () => randomToken(8))).size).toBe(50);
  });
});

describe('request helpers', () => {
  it('trusts only well-formed upstream request ids', () => {
    expect(getRequestId(new Headers({ 'x-request-id': 'abc-123-DEF_456' }))).toBe('abc-123-DEF_456');
    expect(getRequestId(new Headers({ 'x-request-id': 'bad id!' }))).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(getRequestId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it('extracts the first forwarded ip', () => {
    // The last x-forwarded-for entry is the one the trusted proxy appended; the first is client-controllable.
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('10.0.0.1');
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'spoofed, 198.51.100.7', 'x-vercel-forwarded-for': '203.0.113.42' }))).toBe('203.0.113.42');
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(getClientIp(new Headers())).toBe('unknown');
  });
});

describe('job backoff', () => {
  it('grows exponentially with jitter and caps at the policy maximum', () => {
    const fixed = () => 0.5;
    expect(backoffDelayMs(1, { baseMs: 1000, maxMs: 60_000 }, fixed)).toBe(1000);
    expect(backoffDelayMs(2, { baseMs: 1000, maxMs: 60_000 }, fixed)).toBe(2000);
    expect(backoffDelayMs(4, { baseMs: 1000, maxMs: 60_000 }, fixed)).toBe(8000);
    expect(backoffDelayMs(20, { baseMs: 1000, maxMs: 60_000 }, fixed)).toBe(60_000);
    const jittered = backoffDelayMs(3, { baseMs: 1000, maxMs: 60_000 }, () => 1);
    expect(jittered).toBeGreaterThan(4000);
    expect(jittered).toBeLessThanOrEqual(4400);
  });
});
