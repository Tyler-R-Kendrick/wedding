import { beforeAll, describe, expect, it, vi } from 'vitest';

describe('social OAuth scopes', () => {
  beforeAll(() => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'unit-test-google-client');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'unit-test-google-secret-16');
    vi.stubEnv('FACEBOOK_CLIENT_ID', 'unit-test-facebook-client');
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'unit-test-facebook-secret');
  });

  it('requests openid, email, and profile from Google', async () => {
    vi.resetModules();
    const { socialProviderConfig } = await import('@/domain/identity/social/providers');
    const { buildAuthorizationUrl } = await import('@/domain/identity/social/oauth');
    expect(socialProviderConfig('google')?.scopes).toEqual(['openid', 'email', 'profile']);
    const url = buildAuthorizationUrl('google', { state: 's', codeChallenge: 'c', next: null });
    expect(url).toContain('scope=openid+email+profile');
  });

  it('requests email and public_profile from Facebook', async () => {
    vi.resetModules();
    const { socialProviderConfig } = await import('@/domain/identity/social/providers');
    const { buildAuthorizationUrl } = await import('@/domain/identity/social/oauth');
    expect(socialProviderConfig('facebook')?.scopes).toEqual(['email', 'public_profile']);
    const url = buildAuthorizationUrl('facebook', { state: 's', codeChallenge: 'c', next: null });
    expect(url).toContain('scope=email+public_profile');
  });
});
