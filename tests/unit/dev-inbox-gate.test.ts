import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';

// The route reads `env` at request time; a mutable copy lets the test flip to production.
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, env: { ...actual.env } };
});

// Production without a mailer: resolving the auth-email provider throws (the mock is refused).
const getProvider = vi.fn((kind: string) => {
  throw new Error(`${kind}: production requires RESEND_CONNECT_USER_ID and EMAIL_FROM; the mock mailer is refused`);
});
vi.mock('@/providers/registry', () => ({ getProvider: (kind: string) => getProvider(kind) }));

const snapshot = { ...env };
afterEach(() => {
  Object.assign(env, snapshot);
  getProvider.mockClear();
});

describe('/api/dev/inbox in production', () => {
  it('answers 404, not 500, and never resolves the mailer', async () => {
    const { GET, DELETE } = await import('@/app/api/dev/inbox/route');
    Object.assign(env, { isDevelopment: false, isProduction: true, isTest: false, DEV_INBOX_TOKEN: 'inbox-token-0123456789' });
    const auth = { authorization: 'Bearer inbox-token-0123456789' };
    expect((await GET(new Request('http://localhost:3000/api/dev/inbox'))).status).toBe(404);
    expect((await GET(new Request('http://localhost:3000/api/dev/inbox', { headers: auth }))).status).toBe(404);
    expect((await DELETE(new Request('http://localhost:3000/api/dev/inbox', { method: 'DELETE', headers: auth }))).status).toBe(404);
    expect(getProvider).not.toHaveBeenCalled();
  });
});
