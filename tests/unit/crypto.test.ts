import { describe, expect, it } from 'vitest';
import { canonicalJson, hmacSha256, keyedHash, randomNumericCode, randomToken, stableHash, timingSafeEqualString } from '@/lib/crypto';
import { assertSameOriginJson, bearerToken, getClientIp, getRequestId, MAX_CLIENT_IP_CHARS, readBodyBytes } from '@/lib/request';
import { backoffDelayMs } from '@/lib/jobs/queue';

describe('crypto helpers', () => {
  it('hashes canonically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] }, u: undefined })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
  it('treats __proto__ / constructor keys as data, never as prototype mutations', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"a":1}') as Record<string, unknown>;
    const json = canonicalJson(hostile);
    expect(json).toBe('{"__proto__":{"polluted":true},"a":1,"constructor":{"prototype":{"x":1}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(stableHash(hostile)).not.toBe(stableHash({ a: 1 }));
    expect(canonicalJson(Object.assign(Object.create(null), { b: 1, a: 2 }))).toBe('{"a":2,"b":1}');
  });

  it('keyed hashes are canonical and depend on the key', () => {
    expect(keyedHash('k', { a: 1, b: 2 })).toBe(keyedHash('k', { b: 2, a: 1 }));
    expect(keyedHash('k', { a: 1 })).not.toBe(keyedHash('other', { a: 1 }));
    expect(keyedHash('k', { a: 1 })).not.toBe(stableHash({ a: 1 }));
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
  it('derives the client ip from the trusted proxy hops only', () => {
    // One trusted hop: the last x-forwarded-for entry is the one the proxy appended; the first is client-controllable.
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), 1)).toBe('10.0.0.1');
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'spoofed, 198.51.100.7', 'x-vercel-forwarded-for': '203.0.113.42' }), 1)).toBe('203.0.113.42');
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.2' }), 1)).toBe('198.51.100.2');
    expect(getClientIp(new Headers(), 1)).toBe('unknown');
    // Two trusted hops: second entry from the right.
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'client, 10.0.0.1, 10.0.0.2' }), 2)).toBe('10.0.0.1');
    // Fewer entries than trusted hops means the proxies did not append: never trust what is there.
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'spoofed' }), 2)).toBe('unknown');
    // Zero hops (the default, and the default off Vercel): forwarding headers are attacker-controlled and ignored.
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8' }))).toBe('direct');
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.9' }), 0)).toBe('direct');
    // Derived keys are capped so a hostile header cannot bloat the rate-limit table.
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'a'.repeat(1000) }), 1)).toHaveLength(MAX_CLIENT_IP_CHARS);
  });

  it('accepts JSON only from the site origin (CSRF)', () => {
    const req = (headers: Record<string, string>) => new Request('http://localhost:3000/api/x', { method: 'POST', headers });
    const site = 'https://wedding.example';
    expect(assertSameOriginJson(req({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), { siteUrl: site }).ok).toBe(true);
    expect(assertSameOriginJson(req({ 'content-type': 'application/json; charset=utf-8', 'sec-fetch-site': 'none' }), { siteUrl: site }).ok).toBe(true);
    expect(assertSameOriginJson(req({ 'content-type': 'application/json', origin: 'https://wedding.example/' }), { siteUrl: site }).ok).toBe(true);
    const rejected: Record<string, string>[] = [
      { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
      { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
      { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      { 'content-type': 'application/json', 'sec-fetch-site': 'same-site', origin: 'https://evil.wedding.example' },
      { 'content-type': 'application/json', origin: 'https://evil.example' },
      { 'content-type': 'application/json' },
      { 'sec-fetch-site': 'same-origin' },
    ];
    for (const headers of rejected) {
      const r = assertSameOriginJson(req(headers), { siteUrl: site });
      expect(r.ok, JSON.stringify(headers)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('forbidden');
    }
    expect(bearerToken(req({ authorization: 'Bearer abc ' }))).toBe('abc');
    expect(bearerToken(req({ authorization: 'Basic abc' }))).toBeUndefined();
    expect(bearerToken(req({}))).toBeUndefined();
  });

  it('streams request bodies with a hard cap', async () => {
    const make = (chunks: string[], headers: Record<string, string> = {}) =>
      new Request('http://localhost:3000/api/x', {
        method: 'POST',
        headers,
        body: new ReadableStream({
          start(c) {
            for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
            c.close();
          },
        }),
        duplex: 'half',
      } as RequestInit);
    const small = await readBodyBytes(make(['ab', 'cd']), 10);
    expect(small.ok && new TextDecoder().decode(small.value)).toBe('abcd');
    const big = await readBodyBytes(make(['x'.repeat(8), 'y'.repeat(8)]), 10);
    expect(!big.ok && big.error.code).toBe('validation');
    const lying = await readBodyBytes(make(['x'.repeat(8)], { 'content-length': '100' }), 10);
    expect(lying.ok).toBe(false);
    expect((await readBodyBytes(new Request('http://localhost:3000/api/x', { method: 'POST' }), 10)).ok).toBe(true);
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
