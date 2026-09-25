import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { appServices } from '@/capabilities/context';
import { requestOtp } from '@/capabilities/request_otp';
import { errorCode, errorCopy } from '@/app/(auth)/_lib/errors';

/**
 * A deploy without RESEND_CONNECT_USER_ID / EMAIL_FROM (both the preview and production were, on
 * 2026-09-23). `createAuthEmailProvider` refuses the mock on a hosted build, and request_otp used
 * to answer "sent" anyway and fail in the background, so nobody could sign in and everyone was
 * told a code was on its way. It must now say the email service is missing — the same answer for
 * every address, so it tells a caller nothing about who is a guest or an administrator.
 */
async function withoutMailer() {
  const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: `req-nomail-${Math.random()}` });
  const services = appServices(ctx);
  const real = services.providers;
  services.providers = ((kind: Parameters<typeof real>[0], deps?: Parameters<typeof real>[1]) => {
    if (kind === 'auth-email') throw new Error('auth-email: production requires RESEND_CONNECT_USER_ID and EMAIL_FROM; the mock mailer is refused');
    return real(kind, deps);
  }) as typeof real;
  return ctx;
}

describe('sign-in with no email service', () => {
  it('says so, identically for any address, and issues no challenge', async () => {
    const answers = [];
    for (const input of [
      { purpose: 'sign_in', email: 'nobody-at-all@example.test' },
      { purpose: 'admin_sign_in', email: 'owner@example.test' },
      { purpose: 'sign_in', email: 'someone.else@example.test' },
    ]) {
      const r = await invoke(requestOtp, await withoutMailer(), input);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      if (r.ok) return;
      answers.push({ code: r.error.code, message: r.error.message, reason: r.error.details?.reason });
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(answers[0]).toEqual({ code: 'provider_unavailable', message: expect.stringMatching(/no email service/), reason: 'mail_not_configured' });
  });

  it('refuses to claim delivery when Connect authorization is unavailable', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-connect-down' });
    const services = appServices(ctx);
    const real = services.providers;
    services.providers = ((kind: Parameters<typeof real>[0], deps?: Parameters<typeof real>[1]) =>
      kind === 'auth-email' ? { health: async () => ({ status: 'down' as const, checkedAt: new Date().toISOString() }) } : real(kind, deps)) as typeof real;

    const result = await invoke(requestOtp, ctx, { purpose: 'sign_in', email: 'guest@example.test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider_unavailable');
  });

  it('shows the guest a message that is true, not "we sent you a code"', () => {
    const code = errorCode({ code: 'provider_unavailable', details: { reason: 'mail_not_configured' } });
    expect(code).toBe('mail_off');
    expect(errorCopy(code)).toMatch(/can’t send sign-in codes yet/);
    // A transient provider failure keeps its own, different copy.
    expect(errorCode({ code: 'provider_unavailable' })).toBe('provider_unavailable');
  });

  it('still sends when a mailer exists (the mock in tests)', async () => {
    const ctx = await createCapabilityContext({ principal: { kind: 'anonymous' }, requestId: 'req-mail-ok' });
    const r = await invoke(requestOtp, ctx, { purpose: 'sign_in', email: 'nobody-at-all@example.test' });
    expect(r.ok && r.value.data.sent).toBe(true);
  });
});
