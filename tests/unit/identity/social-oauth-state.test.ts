import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeOAuthState, encodeOAuthState, newOAuthStateToken, newPkcePair } from '@/domain/identity/social/state';

describe('social OAuth state (X)', () => {
  beforeEach(() => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'unit-test-secret-at-least-32-chars-long');
  });

  it('X-02: missing or tampered state cookie decodes to null', () => {
    expect(decodeOAuthState(undefined)).toBeNull();
    expect(decodeOAuthState('not-a-valid-payload')).toBeNull();
    const { verifier } = newPkcePair();
    const good = encodeOAuthState({ provider: 'google', codeVerifier: verifier, state: newOAuthStateToken(), next: null });
    const [, sig] = good.split('.');
    expect(decodeOAuthState(`${good.split('.')[0]}.wrong${sig?.slice(5)}`)).toBeNull();
  });

  it('X-03: expired encoded state is rejected on replay', () => {
    const { verifier } = newPkcePair();
    const token = newOAuthStateToken();
    const expired = encodeOAuthState({ provider: 'google', codeVerifier: verifier, state: token, next: '/guests', exp: Date.now() - 1 });
    expect(decodeOAuthState(expired)).toBeNull();
  });
});
