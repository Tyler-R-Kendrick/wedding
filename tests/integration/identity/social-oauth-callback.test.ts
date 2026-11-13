import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/social/[provider]/callback/route';
import { GUEST_SIGN_IN_FAIL_PATH } from '@/domain/identity/social/complete';

describe('social OAuth callback route', () => {
  it('X-01: provider user denial redirects to save-the-date without establishing a session', async () => {
    const req = new NextRequest(
      'http://localhost:3000/api/auth/social/google/callback?error=access_denied&error_description=User%20denied%20access',
    );
    const res = await GET(req, { params: Promise.resolve({ provider: 'google' }) });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain(GUEST_SIGN_IN_FAIL_PATH);
    expect(location).not.toContain('error=');
    const setCookie = res.headers.getSetCookie?.() ?? [];
    expect(setCookie.some((c) => c.includes('session_token'))).toBe(false);
  });
});
