import { describe, expect, it } from 'vitest';
import {
  isTestInjectionEnabled,
  testPrincipal,
  testPrincipalFromRequest,
  TEST_AUTH_HEADER,
  TEST_AUTH_SECRET_MIN_CHARS,
  TEST_PRINCIPAL_HEADER,
} from '@/webmcp/server/test-principal';

/**
 * The test principal injector is the one piece of this level that could become a real
 * authentication bypass, so its gate is tested harder than the feature it enables.
 * Identity (Swarm D) is not on this base; when it lands this module goes away.
 */
const SECRET = 'test-auth-secret-long-enough';
const enabled = { isTest: true, secret: SECRET };

const request = (headers: Record<string, string>) => new Request('https://example.test/api/webmcp/manifest', { headers });

describe('test principal injection gate', () => {
  it('is off unless NODE_ENV is test AND a long enough secret is set', () => {
    expect(isTestInjectionEnabled(enabled)).toBe(true);
    expect(isTestInjectionEnabled({ isTest: false, secret: SECRET })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: undefined })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: '' })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: 'x'.repeat(TEST_AUTH_SECRET_MIN_CHARS - 1) })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: 'x'.repeat(TEST_AUTH_SECRET_MIN_CHARS) })).toBe(true);
  });

  it('ignores the headers entirely when the gate is closed', () => {
    const headers = { [TEST_PRINCIPAL_HEADER]: 'admin', [TEST_AUTH_HEADER]: SECRET };
    expect(testPrincipalFromRequest(request(headers), { isTest: false, secret: SECRET })).toBeUndefined();
    expect(testPrincipalFromRequest(request(headers), { isTest: true, secret: undefined })).toBeUndefined();
  });

  it('refuses a wrong, empty, prefix, or missing secret', () => {
    for (const presented of [undefined, '', 'wrong', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
      const headers: Record<string, string> = { [TEST_PRINCIPAL_HEADER]: 'admin' };
      if (presented !== undefined) headers[TEST_AUTH_HEADER] = presented;
      expect(testPrincipalFromRequest(request(headers), enabled), String(presented)).toBeUndefined();
    }
  });

  it('refuses an unknown principal kind rather than inventing one', () => {
    expect(testPrincipalFromRequest(request({ [TEST_PRINCIPAL_HEADER]: 'system', [TEST_AUTH_HEADER]: SECRET }), enabled)).toBeUndefined();
    expect(testPrincipalFromRequest(request({ [TEST_PRINCIPAL_HEADER]: 'root', [TEST_AUTH_HEADER]: SECRET }), enabled)).toBeUndefined();
    expect(testPrincipal('system')).toBeUndefined();
  });

  it('injects a guest or an admin when everything lines up', () => {
    const guest = testPrincipalFromRequest(request({ [TEST_PRINCIPAL_HEADER]: 'guest', [TEST_AUTH_HEADER]: SECRET }), enabled);
    expect(guest?.kind).toBe('guest');
    const admin = testPrincipalFromRequest(request({ [TEST_PRINCIPAL_HEADER]: 'admin', [TEST_AUTH_HEADER]: SECRET }), enabled);
    expect(admin?.kind).toBe('admin');
  });

  it('makes `guest` stale and `guest-fresh` fresh, so step-up can be tested in both directions', () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const stale = testPrincipal('guest', now);
    const fresh = testPrincipal('guest-fresh', now);
    expect(stale?.kind === 'guest' && Date.parse(stale.authenticatedAt)).toBe(now.getTime() - 60 * 60 * 1000);
    expect(fresh?.kind === 'guest' && Date.parse(fresh.authenticatedAt)).toBe(now.getTime());
  });
});
