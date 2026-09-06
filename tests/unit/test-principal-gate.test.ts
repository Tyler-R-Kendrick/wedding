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
});
