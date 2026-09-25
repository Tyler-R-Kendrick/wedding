import { beforeEach, describe, expect, it, vi } from 'vitest';

const setup = vi.hoisted(() => ({
  token: 'test-operator-token-at-least-thirty-two-characters',
  start: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: { CONNECT_SETUP_TOKEN: setup.token, RESEND_CONNECT_USER_ID: 'test-user' } }));
vi.mock('@vercel/connect', () => ({ startAuthorization: setup.start }));

import { GET } from '@/app/api/connect/resend/authorize/route';

describe('Resend Connect authorization route', () => {
  beforeEach(() => setup.start.mockReset());

  it('does not start authorization without the operator token', async () => {
    const response = await GET(new Request('https://kendrick.wedding/api/connect/resend/authorize'));
    expect(response.status).toBe(403);
    expect(setup.start).not.toHaveBeenCalled();
  });

  it('returns a private authorization URL to the operator', async () => {
    setup.start.mockResolvedValue({ url: 'https://connect.vercel.com/authorize/test' });
    const response = await GET(new Request('https://kendrick.wedding/api/connect/resend/authorize', { headers: { Authorization: `Bearer ${setup.token}` } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ url: 'https://connect.vercel.com/authorize/test' });
    expect(setup.start).toHaveBeenCalledWith('resend/wedding', { subject: { type: 'user', id: 'test-user' } }, { callbackUrl: 'https://kendrick.wedding/' });
  });
});
