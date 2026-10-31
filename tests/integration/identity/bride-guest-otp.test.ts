import { describe, expect, it, vi } from 'vitest';
import { BRIDE_GUEST_EMAIL } from '@/db/seed/bride-guest';
import { devInbox } from '@/providers/auth-email/mock';
import { call, expectOk, latestCode } from './harness';

describe('bride guest sign-in', () => {
  it('request_otp sends a code to Sara Fitzgerald’s guest email', async () => {
    devInbox.clear();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const req = expectOk(
      await call<{ sent: boolean; challenge: string; deliveredTo: string }>(
        'request_otp',
        { purpose: 'sign_in', email: BRIDE_GUEST_EMAIL },
        { ip: '10.9.8.1', logger },
      ),
    );
    expect(req.data.sent).toBe(true);
    expect(req.data.challenge.length).toBeGreaterThan(16);
    expect(req.data.deliveredTo).toMatch(/^s/);
    expect(logger.info.mock.calls.map(([, msg]) => msg)).not.toContain('otp not sent: no guest or administrator has this address');
    const code = await latestCode(BRIDE_GUEST_EMAIL);
    expect(code).toMatch(/^\d{6}$/);
  });
});
