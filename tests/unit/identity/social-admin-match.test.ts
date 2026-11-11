import { describe, expect, it, vi, afterEach } from 'vitest';
import { verifiedProviderEmail } from '@/domain/identity/social/admin-email';
import type { OAuthProfile } from '@/domain/identity/social/oauth';

describe('verifiedProviderEmail', () => {
  it('accepts a verified Google email', () => {
    const profile: OAuthProfile = { providerAccountId: 'g1', email: 'Owner@Example.com', emailVerified: true };
    expect(verifiedProviderEmail(profile)).toBe('owner@example.com');
  });

  it('rejects unverified Google email for admin matching', () => {
    const profile: OAuthProfile = { providerAccountId: 'g1', email: 'owner@example.com', emailVerified: false };
    expect(verifiedProviderEmail(profile)).toBeNull();
  });

  it('treats Facebook email as verified when present', () => {
    const profile: OAuthProfile = { providerAccountId: 'fb1', email: 'owner@example.com', emailVerified: true };
    expect(verifiedProviderEmail(profile)).toBe('owner@example.com');
  });

  it('rejects missing Facebook email', () => {
    const profile: OAuthProfile = { providerAccountId: 'fb1', email: null, emailVerified: false };
    expect(verifiedProviderEmail(profile)).toBeNull();
  });
});

describe('fetchProviderProfile (Google email_verified)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Google email_verified=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ sub: 'sub', email: 'a@b.com', email_verified: true }),
      })),
    );
    const { fetchProviderProfile } = await import('@/domain/identity/social/oauth');
    const profile = await fetchProviderProfile('google', 'token');
    expect(profile?.emailVerified).toBe(true);
    expect(profile?.email).toBe('a@b.com');
  });
});
