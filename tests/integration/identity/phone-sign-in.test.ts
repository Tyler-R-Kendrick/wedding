import { describe, expect, it, beforeEach } from 'vitest';
import { call, expectErr, expectOk, grantAdmin, seed, signIn } from './harness';
import { setProviderOverride, resetProviders } from '@/providers/registry';
import { MockTwilioVerify } from '@/providers/twilio-verify';
import type { RequestPhoneOtpResult } from '@/capabilities/request_phone_otp';
import type { SignInOutcome } from '@/capabilities/identity/signin';

describe('phone sign-in', () => {
  beforeEach(() => {
    resetProviders();
    setProviderOverride('twilio-verify', new MockTwilioVerify());
    MockTwilioVerify.clearPending();
    process.env.FLAG_PHONE_SIGN_IN = 'on';
  });

  it('returns the same shape for unknown and known numbers', async () => {
    const known = expectOk(await call<RequestPhoneOtpResult>('request_phone_otp', { phone: '+15559876543' }));
    const unknown = expectOk(await call<RequestPhoneOtpResult>('request_phone_otp', { phone: '+15550001111' }));
    expect(known.data.sent).toBe(true);
    expect(unknown.data.sent).toBe(true);
    expect(known.data.challenge).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(unknown.data.challenge).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  });

  it('signs in when the code matches the mock Verify provider', async () => {
    const f = await seed('ph1');
    await grantAdmin(f.emails.admin, 'owner');
    const admin = await signIn(f.emails.admin, {}, 'admin_sign_in');
    expectOk(
      await call(
        'admin_upsert_guest',
        { id: f.guests.chidi, householdId: f.households.okafor, firstName: 'Chidi', lastName: 'Okafor', phone: '+15551230001', email: f.emails.chidi },
        { cookie: admin.cookie },
      ),
    );
    const listed = expectOk(await call<{ guests: { id: string; phone: string | null }[] }>('admin_list_guests', { householdId: f.households.okafor }, { cookie: admin.cookie }));
    expect(listed.data.guests.find((g) => g.id === f.guests.chidi)?.phone).toBe('+15551230001');
    const sent = expectOk(await call<RequestPhoneOtpResult>('request_phone_otp', { phone: '+15551230001' }));
    const verified = expectOk(await call<SignInOutcome>('verify_phone_otp', { challenge: sent.data.challenge, code: '000000' }));
    expect(verified.data.status).toBe('signed_in');
    expect(verified.data.guestId).toBe(f.guests.chidi);
  });

  it('refuses verify when the number was not on file', async () => {
    await seed('ph2');
    const sent = expectOk(await call<RequestPhoneOtpResult>('request_phone_otp', { phone: '+15550999999' }));
    expectErr(await call('verify_phone_otp', { challenge: sent.data.challenge, code: '000000' }), 'validation');
  });
});
