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
    expect((await getOtpLockout(db, hashOtpIdentifier(f.emails.chidi), hashOtpIdentifier('10.9.1.1'))).locked).toBe(true);
    const locked = expectErr(await call('verify_otp', { challenge: req.data.challenge, code: await latestCode(f.emails.chidi) }, { ip: '10.9.1.1' }), 'rate_limited');
    expect(locked.message).toMatch(/15 minutes/);
    expect(typeof locked.details?.retryAfterMs).toBe('number');
    // Review S10: the lock is per (email, client); the guest on their own device is not locked out by a stranger.
    expect((await getOtpLockout(db, hashOtpIdentifier(f.emails.chidi), hashOtpIdentifier('10.9.1.2'))).locked).toBe(false);
    const own = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'claim', token: f.invitations.okafor.token, guestId: f.guests.chidi }, { ip: '10.9.1.2' }));
    const ok = await call('verify_otp', { challenge: own.data.challenge, code: await latestCode(f.emails.chidi) }, { ip: '10.9.1.2' });
    expect(ok.ok).toBe(true);
  });

  it('send limits: 5 per (email, client), a soft 20 per email across clients, and a per-IP cap', async () => {
    const f = await seed('ab2');
    for (let i = 0; i < 5; i++) expectOk(await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: '10.9.2.1' }));
    expectErr(await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: '10.9.2.1' }), 'rate_limited');
    // A different client (the guest's own phone) still gets codes: a stranger cannot exhaust the guest's allowance.
    expectOk(await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: '10.9.2.2' }));
    let softDenied = 0;
    for (let i = 0; i < 20; i++) {
      const r = await call('request_otp', { purpose: 'sign_in', email: f.emails.amara }, { ip: `10.9.5.${i + 1}` });
      if (!r.ok && r.error.code === 'rate_limited') softDenied++;
    }
    expect(softDenied).toBeGreaterThanOrEqual(1); // the per-email ceiling bounds inbox flooding
    const ip = '10.9.3.3';
    let denied = 0;
    for (let i = 0; i < 61; i++) {
      const r = await call('request_otp', { purpose: 'sign_in', email: `spray${i}+ab2@example.test` }, { ip });
      if (!r.ok && r.error.code === 'rate_limited') denied++;
    }
    expect(denied).toBeGreaterThanOrEqual(1);
    expect(devInbox.list().filter((m) => m.to.startsWith('spray'))).toHaveLength(0); // unknown addresses never receive mail
  });

  it('S8: the provider send is not awaited — a slow mailer does not delay the answer, and known/unknown take the same floor', async () => {
    const f = await seed('ab4');
    const { setProviderOverride } = await import('@/providers/registry');
    const { MockAuthEmail } = await import('@/providers/auth-email/mock');
    const slow = new MockAuthEmail();
    const realSend = slow.sendOtp.bind(slow);
    slow.sendOtp = async (m) => {
      await new Promise((r) => setTimeout(r, 700));
      return realSend(m);
    };
    setProviderOverride('auth-email', slow);
    try {
      const t0 = performance.now();
      const known = await call<{ sent: boolean }>('request_otp', { purpose: 'sign_in', email: f.emails.ana }, { ip: '10.9.6.1' });
      const knownMs = performance.now() - t0;
      const t1 = performance.now();
      const unknown = await call<{ sent: boolean }>('request_otp', { purpose: 'sign_in', email: 'ghost+ab4@example.test' }, { ip: '10.9.6.2' });
      const unknownMs = performance.now() - t1;
      expect(known.ok && unknown.ok).toBe(true);
      expect(knownMs).toBeLessThan(600); // answered before the 700 ms mailer finished
      expect(knownMs).toBeGreaterThanOrEqual(140);
      expect(unknownMs).toBeGreaterThanOrEqual(140);
      expect(Math.abs(knownMs - unknownMs)).toBeLessThan(120);
      expect(await latestCode(f.emails.ana)).toMatch(/^\d{6}$/); // still delivered, later
    } finally {
      setProviderOverride('auth-email', undefined);
    }
  });

  it('per-code attempt cap: Better Auth discards a code after 5 wrong tries', async () => {
    const f = await seed('ab3');
    const req = expectOk(await call<{ challenge: string }>('request_otp', { purpose: 'sign_in', email: f.emails.ana }, { ip: '10.9.4.1' }));
    const code = await latestCode(f.emails.ana);
    for (let i = 0; i < 5; i++) await call('verify_otp', { challenge: req.data.challenge, code: String(200000 + i) }, { ip: `10.9.4.${i + 2}` });
    // Lockout (5 failures) and the per-code cap both hold now; the correct code no longer works.
    expect((await call('verify_otp', { challenge: req.data.challenge, code }, { ip: '10.9.4.50' })).ok).toBe(false);
  });
});
