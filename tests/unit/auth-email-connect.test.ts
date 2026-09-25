import { getToken } from '@vercel/connect';
import { beforeEach, expect, it, vi } from 'vitest';
import { ResendAuthEmail } from '@/providers/auth-email/resend';

vi.mock('@vercel/connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/connect')>()),
  getToken: vi.fn(),
}));

beforeEach(() => vi.mocked(getToken).mockReset());

it('exchanges project identity for Resend credential on each delivery', async () => {
  vi.mocked(getToken).mockResolvedValue('short-lived-token');
  const send = vi.fn<typeof fetch>(async () => Response.json({ id: 'email_123' }));
  const mailer = new ResendAuthEmail('user_123', 'Sara + Tyler <hello@kendrick.wedding>', send);

  const result = await mailer.sendMessage({ to: 'guest@example.com', subject: 'RSVP received', text: 'Thank you.' });

  expect(result).toEqual({ ok: true, value: { messageId: 'email_123' } });
  expect((await mailer.health()).status).toBe('up');
  expect(getToken).toHaveBeenCalledWith('resend/wedding', { subject: { type: 'user', id: 'user_123' } });
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer short-lived-token' } });
});
