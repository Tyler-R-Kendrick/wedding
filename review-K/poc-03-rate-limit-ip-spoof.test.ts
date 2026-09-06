/**
 * FINDING 3 — the only DoS control on this new anonymous surface is keyed on a value the client
 * supplies, so it can be reset at will; and in the default configuration (TRUSTED_PROXY_HOPS=0)
 * every anonymous visitor on earth shares one bucket.
 *
 * src/webmcp/server/handlers.ts:35-36  limiterKeyFor -> `webmcp:anon:${ip}`
 * src/webmcp/server/handlers.ts:51,82  ip = getClientIp(headers, env.TRUSTED_PROXY_HOPS)
 * src/lib/request.ts:26-41             getClientIp
 *
 * Two problems, both reachable without a session:
 *  (a) with TRUSTED_PROXY_HOPS >= 1 (the default on Vercel, and what the repo's own e2e runs with)
 *      `x-vercel-forwarded-for` is read FIRST and taken verbatim — `.split(',').pop()` — with no
 *      proxy involved. Off Vercel nothing overwrites it, so the caller picks its own bucket.
 *  (b) with TRUSTED_PROXY_HOPS = 0 (the default everywhere else) every caller collapses to the
 *      single key `direct`, so one client can hold the whole site's anonymous budget down.
 *
 * This matters more now than it did before level 13: every WebMCP-capable page load fetches
 * `/api/webmcp/manifest`, and that fetch consumes both `cap:ip:<ip>` and `webmcp:anon:<ip>`.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-03-rate-limit-ip-spoof.test.ts
 */
import { describe, expect, it } from 'vitest';
import { getClientIp } from '@/lib/request';
import { GET as MANIFEST } from '@/app/api/webmcp/manifest/route';

const get = (headers: Record<string, string>) => MANIFEST(new Request('http://localhost:3000/api/webmcp/manifest', { headers }));

describe('FINDING 3: the anonymous rate-limit bucket is chosen by the caller', () => {
  it('(a) x-vercel-forwarded-for is attacker-controlled and wins over x-forwarded-for', () => {
    const h = (init: Record<string, string>) => new Headers(init);
    // FIXED (swarm K): off Vercel, `x-vercel-forwarded-for` is just a request header that nothing
    // overwrites, so it is ignored and the real hop arithmetic decides. These first two lines
    // recorded the vulnerable behaviour ('whatever-i-like' and 'last-wins') and invert now.
    expect(getClientIp(h({ 'x-vercel-forwarded-for': 'whatever-i-like', 'x-forwarded-for': '203.0.113.9' }), 1)).toBe('203.0.113.9');
    expect(getClientIp(h({ 'x-vercel-forwarded-for': 'a,b,last-wins' }), 1)).toBe('unknown');
    expect(
      getClientIp(h({ 'x-vercel-forwarded-for': 'spoofed' }), 1),
      'a forwarding header a client can set must not decide the rate-limit bucket',
    ).toBe('unknown');
    // On Vercel the platform really does overwrite it, so there it is still the right source.
    expect(getClientIp(h({ 'x-vercel-forwarded-for': '203.0.113.5' }), 1, true)).toBe('203.0.113.5');
  });

  it('(b) with the default TRUSTED_PROXY_HOPS=0 every anonymous caller shares one bucket', () => {
    const alice = getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.1' }), 0);
    const mallory = getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.2' }), 0);
    // hops=0 means "nothing is in front of me", so every forwarding header IS attacker-controlled
    // and ignoring it is correct. The consequence — one shared bucket — is a deployment posture
    // problem, not something getClientIp can fix: separating clients requires actually trusting a
    // proxy. env.ts now warns at boot when a production app runs with hops=0.
    expect({ alice, mallory }).toEqual({ alice: 'direct', mallory: 'direct' });
    // Configured for the proxy that is really there, the two clients are separated as they must be.
    // (This line asserted `alice !== mallory` at hops=0, which cannot hold alongside the line above.)
    expect(
      getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.1' }), 1),
      'two different anonymous clients must not share a rate-limit bucket',
    ).not.toBe(getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.2' }), 1));
  });

  it('(c) end to end: exhaust the anonymous bucket, then walk straight past it by rotating a header', async () => {
    const victimIp = '198.51.100.77';
    let exhaustedAfter = -1;
    // The manifest now has its own policy (capacity 240, refill 4/s) instead of sharing the
    // 60-token `capability` bucket with /api/capabilities — part of the same fix, so that a page
    // load no longer spends the budget the UI route needs. The loop is sized for that bucket.
    for (let i = 0; i < 400; i++) {
      const response = await get({ 'x-forwarded-for': victimIp });
      if (response.status === 429) {
        exhaustedAfter = i;
        break;
      }
    }
    expect(exhaustedAfter, 'the limiter should stop a flood from one client').toBeGreaterThan(0);

    // Same attacker, same connection, new bucket every request.
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await get({ 'x-forwarded-for': victimIp, 'x-vercel-forwarded-for': `bypass-${i}` })).status);
    }
    expect(
      statuses.filter((s) => s === 429).length,
      'after exhausting its bucket the same client must not be able to keep going by changing a header',
    ).toBeGreaterThan(0);
  });
});
