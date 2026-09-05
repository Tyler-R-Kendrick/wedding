import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { getOtpLockout, hashOtpIdentifier } from '@/domain/identity/otp';
import { devInbox } from '@/providers/auth-email/mock';
import { call, expectErr, expectOk, latestCode, seed } from './harness';

describe('OTP abuse controls', () => {
  it('five wrong codes lock the address for 15 minutes, even for the right code', async () => {
    const f = await seed('ab1');
    const req = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'claim', token: f.invitations.okafor.token, guestId: f.guests.chidi }, { ip: '10.9.1.1' }));
    for (let i = 0; i < 5; i++) {
      const r = await call('verify_otp', { challenge: req.data.challenge, code: String(100000 + i) }, { ip: '10.9.1.1' });
      expect(r.ok).toBe(false);
    }
    const db = await getDb();
    expect((await getOtpLockout(db, hashOtpIdentifier(f.emails.chidi))).locked).toBe(true);
    const locked = expectErr(await call('verify_otp', { challenge: req.data.challenge, code: latestCode(f.emails.chidi) }, { ip: '10.9.1.1' }), 'rate_limited');
    expect(locked.message).toMatch(/15 minutes/);
    expect(typeof locked.details?.retryAfterMs).toBe('number');
  });

  it('per-email send limit (5 per 10 minutes) and per-IP send limit apply', async () => {
    const f = await seed('ab2');
    for (let i = 0; i < 5; i++) expectOk(await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: `10.9.2.${i}` }));
    expectErr(await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: '10.9.2.99' }), 'rate_limited');
    const ip = '10.9.3.3';
    let denied = 0;
    for (let i = 0; i < 16; i++) {
      const r = await call('request_otp', { purpose: 'sign_in', email: `spray${i}+ab2@example.test` }, { ip });
      if (!r.ok && r.error.code === 'rate_limited') denied++;
    }
    expect(denied).toBeGreaterThanOrEqual(1);
    expect(devInbox.list().filter((m) => m.to.startsWith('spray'))).toHaveLength(0); // unknown addresses never receive mail
  });

  it('per-code attempt cap: Better Auth discards a code after 5 wrong tries', async () => {
    const f = await seed('ab3');
    const req = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'sign_in', email: f.emails.ana }, { ip: '10.9.4.1' }));
    const code = latestCode(f.emails.ana);
    for (let i = 0; i < 5; i++) await call('verify_otp', { challenge: req.data.challenge, code: String(200000 + i) }, { ip: `10.9.4.${i + 2}` });
    // Lockout (5 failures) and the per-code cap both hold now; the correct code no longer works.
    expect((await call('verify_otp', { challenge: req.data.challenge, code }, { ip: '10.9.4.50' })).ok).toBe(false);
  });
});
