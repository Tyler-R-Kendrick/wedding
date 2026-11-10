import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ isProduction: true, FORCE_MOCK_PROVIDERS: false }) as Record<string, unknown>);
const ready = vi.hoisted(() => vi.fn());
vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('@/providers/twilio-verify', () => ({
  twilioVerifyConfigured: (e: Record<string, unknown>) => !!(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_VERIFY_SERVICE_SID),
  connectTwilioVerify: () => ({ ready }),
}));

import { isPhoneSignInAvailable, resetPhoneSignInAvailability } from '@/lib/phone-sign-in';

describe('whether a guest is offered sign-in by text', () => {
  beforeEach(() => {
    resetPhoneSignInAvailability();
    ready.mockReset();
    Object.assign(env, { isProduction: true, FORCE_MOCK_PROVIDERS: false, TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined, TWILIO_VERIFY_SERVICE_SID: undefined });
  });

  it('is always offered outside production, and with Twilio credentials set, without asking the connector', async () => {
    env.isProduction = false;
    expect(await isPhoneSignInAvailable()).toBe(true);
    Object.assign(env, { isProduction: true, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA1' });
    expect(await isPhoneSignInAvailable()).toBe(true);
    expect(ready).not.toHaveBeenCalled();
  });

  it('in production follows the connector: a yes is kept ten minutes', async () => {
    ready.mockResolvedValue({ ok: true });
    const now = Date.now();
    expect(await isPhoneSignInAvailable(now)).toBe(true);
    expect(await isPhoneSignInAvailable(now + 9 * 60_000)).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    await isPhoneSignInAvailable(now + 11 * 60_000);
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it('a no is asked again after a minute, so the option appears once the connector is connected', async () => {
    ready.mockResolvedValueOnce({ ok: false, reason: 'connector twilio/wedding gave no token' }).mockResolvedValue({ ok: true });
    const now = Date.now();
    expect(await isPhoneSignInAvailable(now)).toBe(false);
    expect(await isPhoneSignInAvailable(now + 30_000)).toBe(false);
    expect(await isPhoneSignInAvailable(now + 61_000)).toBe(true);
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it('is off when providers are forced to mocks in production, where no text could be sent', async () => {
    env.FORCE_MOCK_PROVIDERS = true;
    expect(await isPhoneSignInAvailable()).toBe(false);
    expect(ready).not.toHaveBeenCalled();
  });
});
