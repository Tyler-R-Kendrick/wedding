import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { call, expectOk, grantAdmin, seed } from './harness';
import { getDb } from '@/db/client';
import { guests } from '@/db/schema';
import { ensureAdminPhones, parseAdminPhones, resetAdminPhones, seedAdminPhones } from '@/domain/guests/admin-phones';
import { setProviderOverride, resetProviders } from '@/providers/registry';
import { MockTwilioVerify } from '@/providers/twilio-verify';
import type { RequestPhoneOtpResult } from '@/capabilities/request_phone_otp';
import type { SignInOutcome } from '@/capabilities/identity/signin';

describe('administrators’ phone numbers', () => {
  beforeEach(() => {
    resetProviders();
    resetAdminPhones();
    setProviderOverride('twilio-verify', new MockTwilioVerify());
    MockTwilioVerify.clearPending();
  });

  it('reads email=phone pairs and skips anything malformed', () => {
    expect(parseAdminPhones(' Owner@Example.com = (555) 201-0001 , bad , nope@example.com=12, other@example.com=+15552010002, owner@example.com=+15552019999')).toEqual([
      { email: 'owner@example.com', phone: '+15552010001' },
      { email: 'other@example.com', phone: '+15552010002' },
    ]);
    expect(parseAdminPhones(undefined)).toEqual([]);
  });

  it('creates a guest record for an admin who has none, and that number then signs them in as the admin', async () => {
    const db = await getDb();
    const email = 'phone-admin-new@example.com';
    await grantAdmin(email, 'owner');
    const seeded = await seedAdminPhones(db, parseAdminPhones(`${email}=+15552010003`));
    expect(seeded).toEqual({ updated: 0, created: 1, unchanged: 0, failed: 0 });
    const [row] = await db.select().from(guests).where(eq(guests.email, email));
    expect(row).toMatchObject({ phone: '+15552010003', kind: 'adult', isMinor: false, firstName: 'phone-admin-new' });

    const sent = expectOk(await call<RequestPhoneOtpResult>('request_phone_otp', { phone: '(555) 201-0003' }));
    const verified = expectOk(await call<SignInOutcome>('verify_phone_otp', { challenge: sent.data.challenge, code: '000000' }));
    expect(verified.data.status).toBe('signed_in');
    expect(verified.data.isAdmin).toBe(true);
    expect(verified.data.guestId).toBe(row!.id);
  });

  it('puts the number on an existing guest record and changes nothing on the next pass', async () => {
    const db = await getDb();
    const f = await seed('adminphone');
    const pairs = parseAdminPhones(`${f.emails.chidi}=+15552010004`);
    expect(await seedAdminPhones(db, pairs)).toEqual({ updated: 1, created: 0, unchanged: 0, failed: 0 });
    const [row] = await db.select().from(guests).where(eq(guests.id, f.guests.chidi));
    expect(row?.phone).toBe('+15552010004');
    expect(await seedAdminPhones(db, pairs)).toEqual({ updated: 0, created: 0, unchanged: 1, failed: 0 });
    // Once per process and value: the same setting is not seeded twice.
    const first = ensureAdminPhones(db, `${f.emails.chidi}=+15552010004`);
    await first;
    expect(ensureAdminPhones(db, `${f.emails.chidi}=+15552010004`)).toBe(first);
  });
});
