import { describe, expect, it } from 'vitest';
import { resolveTestPrincipal, TEST_AUTH_HEADER, TEST_PRINCIPAL_HEADER, testPrincipalEnabled } from '@/ai/test-principal';

/**
 * The e2e principal injector is an authentication bypass by construction, so what matters is that it
 * is off unless every condition holds at once — and that it is off on any deployed environment
 * regardless of what NODE_ENV says.
 */
const SECRET = 'a-test-auth-secret-value';
const request = (headers: Record<string, string>) => new Request('http://localhost/api/ai/chat', { method: 'POST', headers });
type NodeEnv = 'development' | 'production' | 'test';
const env = (over: Partial<{ NODE_ENV: NodeEnv; TEST_AUTH_SECRET: string; VERCEL: string; CI: string }> = {}) => ({ NODE_ENV: 'test' as NodeEnv, TEST_AUTH_SECRET: SECRET as string | undefined, VERCEL: undefined as string | undefined, CI: undefined as string | undefined, ...over });

describe('test principal injector', () => {
  it('is off without NODE_ENV=test, without the secret, and on any deployed environment', () => {
    expect(testPrincipalEnabled(env({ NODE_ENV: 'production' }))).toBe(false);
    expect(testPrincipalEnabled(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(testPrincipalEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(testPrincipalEnabled(env({ VERCEL: '1' }))).toBe(false);
    expect(testPrincipalEnabled(env({ CI: 'true' }))).toBe(false);
    expect(testPrincipalEnabled(env())).toBe(true);
  });

  it('refuses a wrong, missing or empty secret', () => {
    const headers = { [TEST_PRINCIPAL_HEADER]: 'guest-a' };
    expect(resolveTestPrincipal(request(headers), env())).toBeUndefined();
    expect(resolveTestPrincipal(request({ ...headers, [TEST_AUTH_HEADER]: '' }), env())).toBeUndefined();
    expect(resolveTestPrincipal(request({ ...headers, [TEST_AUTH_HEADER]: 'wrong' }), env())).toBeUndefined();
    expect(resolveTestPrincipal(request({ ...headers, [TEST_AUTH_HEADER]: `${SECRET}x` }), env())).toBeUndefined();
  });

  it('resolves only the fixed presets, and never in production', () => {
    const headers = { [TEST_PRINCIPAL_HEADER]: 'guest-a', [TEST_AUTH_HEADER]: SECRET };
    const guest = resolveTestPrincipal(request(headers), env());
    expect(guest?.kind).toBe('guest');
    expect(resolveTestPrincipal(request({ ...headers, [TEST_PRINCIPAL_HEADER]: 'owner' }), env())).toBeUndefined();
    expect(resolveTestPrincipal(request(headers), env({ NODE_ENV: 'production' }))).toBeUndefined();
    expect(resolveTestPrincipal(request(headers), env({ VERCEL: '1' }))).toBeUndefined();
  });

  it('gives guest A and guest B different households so a leak is visible', () => {
    const a = resolveTestPrincipal(request({ [TEST_PRINCIPAL_HEADER]: 'guest-a', [TEST_AUTH_HEADER]: SECRET }), env());
    const b = resolveTestPrincipal(request({ [TEST_PRINCIPAL_HEADER]: 'guest-b', [TEST_AUTH_HEADER]: SECRET }), env());
    expect(a?.kind === 'guest' && b?.kind === 'guest' && a.householdId !== b.householdId).toBe(true);
  });
});
