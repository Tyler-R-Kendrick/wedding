import { describe, expect, it } from 'vitest';
import { devEndpointAllowedFor } from '@/lib/auth/dev-gate';
import { createAuthEmailProvider } from '@/providers/auth-email';

const req = (bearer?: string) => new Request('http://localhost/api/dev/identity', { method: 'POST', headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
const TOKEN = 'dev-inbox-token-for-tests-0123';

describe('dev endpoint gate (review S5)', () => {
  it('never opens in production, even with a matching bearer', () => {
    const prod = { isProduction: true, isDevelopment: false, DEV_INBOX_TOKEN: TOKEN, hosted: true };
    expect(devEndpointAllowedFor(req(TOKEN), prod)).toBe(false);
    expect(devEndpointAllowedFor(req(TOKEN), { ...prod, hosted: false })).toBe(false);
    expect(devEndpointAllowedFor(req(), prod)).toBe(false);
  });
  it('opens on a local development server, or for previews/CI only with the bearer', () => {
    expect(devEndpointAllowedFor(req(), { isProduction: false, isDevelopment: true, hosted: false })).toBe(true);
    expect(devEndpointAllowedFor(req(), { isProduction: false, isDevelopment: true, hosted: true })).toBe(false);
    expect(devEndpointAllowedFor(req(TOKEN), { isProduction: false, isDevelopment: false, DEV_INBOX_TOKEN: TOKEN, hosted: true })).toBe(true);
    expect(devEndpointAllowedFor(req('wrong-token-000000000000'), { isProduction: false, isDevelopment: false, DEV_INBOX_TOKEN: TOKEN, hosted: true })).toBe(false);
    expect(devEndpointAllowedFor(req(TOKEN), { isProduction: false, isDevelopment: false, hosted: true })).toBe(false);
  });
});

describe('auth-email provider selection (review S6)', () => {
  it('refuses the mock mailer on a production host and uses Resend when configured', () => {
    expect(() => createAuthEmailProvider({ FORCE_MOCK_PROVIDERS: false, isProduction: true })).toThrow(/RESEND_API_KEY/);
    expect(() => createAuthEmailProvider({ FORCE_MOCK_PROVIDERS: true, RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.co', isProduction: true })).toThrow(/mock mailer/);
    expect(createAuthEmailProvider({ FORCE_MOCK_PROVIDERS: false, RESEND_API_KEY: 're_x', EMAIL_FROM: 'a@b.co', isProduction: true }).name).toBe('resend');
    expect(createAuthEmailProvider({ FORCE_MOCK_PROVIDERS: false, isProduction: false }).name).toBe('mock');
  });
});
