import { describe, expect, it } from 'vitest';
import { createTestPrincipalResolver, isTestPrincipalEnabled, principalFromSpec } from '@/domain/testing/testPrincipal';
import type { Principal } from '@/contracts/principal';
import type { PrincipalResolver } from '@/lib/principal';

/**
 * This resolver turns two request headers into any principal, so the gate around it is the only
 * thing between a header and full guest or admin authority.
 */
const anonymous: Principal = { kind: 'anonymous' };
const fallback: PrincipalResolver = { resolve: async () => anonymous };
const SECRET = 'test-secret-0123456789abcdef';
// Crockford base32, 26 chars (ID_PATTERN): an invalid id would make every negative case below pass
// for the wrong reason, so the positive case has to genuinely inject.
const spec = { kind: 'admin' as const, adminId: '0'.repeat(26) };

const req = (headers: Record<string, string>) => new Request('http://localhost/api/capabilities/x', { method: 'POST', headers });
const injected = () => ({ 'x-test-auth': SECRET, 'x-test-principal': JSON.stringify(spec) });

describe('the test principal resolver is unreachable unless deliberately enabled', () => {
  it('is disabled outside NODE_ENV=test, whatever headers arrive', async () => {
    const r = createTestPrincipalResolver(fallback, { isTest: false, secret: SECRET });
    expect(await r.resolve(req(injected()))).toEqual(anonymous);
  });

  it('is disabled without a secret, and without one long enough to be a secret', () => {
    expect(isTestPrincipalEnabled({ isTest: true, secret: undefined })).toBe(false);
    expect(isTestPrincipalEnabled({ isTest: true, secret: 'short' })).toBe(false);
    expect(isTestPrincipalEnabled({ isTest: true, secret: SECRET })).toBe(true);
  });

  it('falls through on a wrong secret, a missing header, and unparseable JSON', async () => {
    const r = createTestPrincipalResolver(fallback, { isTest: true, secret: SECRET });
    expect(await r.resolve(req({ ...injected(), 'x-test-auth': 'wrong-secret-0123456789' }))).toEqual(anonymous);
    expect(await r.resolve(req({ 'x-test-principal': JSON.stringify(spec) }))).toEqual(anonymous);
    expect(await r.resolve(req({ 'x-test-auth': SECRET, 'x-test-principal': '{not json' }))).toEqual(anonymous);
    expect(await r.resolve(req({ 'x-test-auth': SECRET, 'x-test-principal': JSON.stringify({ kind: 'wizard' }) }))).toEqual(anonymous);
  });

  it('injects only when everything lines up', async () => {
    const r = createTestPrincipalResolver(fallback, { isTest: true, secret: SECRET });
    expect((await r.resolve(req(injected()))).kind).toBe('admin');
    expect(principalFromSpec(spec).kind).toBe('admin');
  });

  // Ported from swarm H's own injector test at level 10, when its duplicate resolver was deleted.
  // `system` is the interesting one: unlike `wizard` above it is a REAL principal kind, used by
  // seeds and jobs, so "unknown kind is refused" does not cover it — a header must never be able to
  // claim it.
  it('never injects a system principal, and refuses an entitlement that is not one', async () => {
    const r = createTestPrincipalResolver(fallback, { isTest: true, secret: SECRET });
    const as = (principal: unknown) => req({ 'x-test-auth': SECRET, 'x-test-principal': JSON.stringify(principal) });
    expect(await r.resolve(as({ kind: 'system', component: 'seed' }))).toEqual(anonymous);
    expect(await r.resolve(as({ kind: 'guest', guestId: '0'.repeat(26), householdId: '1'.repeat(26), entitlements: ['root'] }))).toEqual(anonymous);
  });

  it('can mint a stale principal and a fresh one, so step-up is testable in both directions', async () => {
    // Ported from swarm K's own gate test (`guest` stale vs `guest-fresh`), which is the one case
    // main's version did not already cover. K expressed it as two canned kinds; the canonical
    // resolver takes a spec, so the same guarantee is that `authenticatedAt` survives the round
    // trip. If it were dropped and defaulted to "now", every principal would be fresh and every
    // step-up test would pass without exercising the gate at all — a whole security control
    // silently untested.
    const stale = '2020-01-01T00:00:00.000Z';
    const guest = { kind: 'guest' as const, guestId: '0'.repeat(26), householdId: '1'.repeat(26) };

    const staleP = principalFromSpec({ ...guest, authenticatedAt: stale });
    expect(staleP.kind === 'guest' && staleP.authenticatedAt).toBe(stale);
    // Omitted means "now", which requireFreshSession accepts.
    const freshP = principalFromSpec(guest);
    const fresh = freshP.kind === 'guest' ? freshP.authenticatedAt : '';
    expect(Date.now() - Date.parse(fresh)).toBeLessThan(5_000);

    // And it survives the resolver, not just the constructor.
    const r = createTestPrincipalResolver(fallback, { isTest: true, secret: SECRET });
    const viaHeaders = await r.resolve(req({ 'x-test-auth': SECRET, 'x-test-principal': JSON.stringify({ ...guest, authenticatedAt: stale }) }));
    expect(viaHeaders.kind === 'guest' && viaHeaders.authenticatedAt).toBe(stale);
  });

  it('is the ONE gate: closed in development and production, open only under test with a real secret', () => {
    // Level 13 deleted swarm K's local copy of this gate, which read
    // `env.isTest && !env.isProduction` where this one reads `env.isTest`. The extra clause was
    // redundant — NODE_ENV is a three-value enum, so `isTest` already excludes production — but
    // "redundant" is a claim, and this is the gate that decides whether a header becomes an admin
    // AND (since level 13) whether the synthetic WebMCP fixtures register at all. So it is stated
    // rather than argued.
    const long = 'x'.repeat(16);
    expect(isTestPrincipalEnabled({ isTest: true, secret: long })).toBe(true);
    expect(isTestPrincipalEnabled({ isTest: false, secret: long })).toBe(false);
    // A secret is required, and a short one is not a secret.
    expect(isTestPrincipalEnabled({ isTest: true, secret: undefined })).toBe(false);
    expect(isTestPrincipalEnabled({ isTest: true, secret: 'x'.repeat(15) })).toBe(false);
    expect(isTestPrincipalEnabled({ isTest: true, secret: '' })).toBe(false);
  });

  it('a deployed app cannot be a test run at all', async () => {
    // The control level 13 adds ON TOP of the gate above, ported from swarm K. `NODE_ENV=test`
    // beside a deploy marker does not merely close the gate — the app refuses to start, so there is
    // no window in which a misconfigured deploy serves requests with the injector reachable.
    const { parseServerEnv } = await import('@/lib/env');
    const base = { NODE_ENV: 'test', PGLITE_MEMORY: '1' };
    expect(() => parseServerEnv({ ...base, VERCEL: '1' })).toThrow(/not allowed on a deployed app/);
    expect(() => parseServerEnv({ ...base, VERCEL_ENV: 'preview' })).toThrow(/not allowed on a deployed app/);
    // CI is not a deployment: CI is exactly where NODE_ENV=test belongs.
    expect(() => parseServerEnv({ ...base, CI: 'true' })).not.toThrow();
    expect(() => parseServerEnv(base)).not.toThrow();
  });
});
