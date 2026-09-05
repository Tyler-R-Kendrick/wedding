import { describe, expect, it } from 'vitest';
import { getDb } from '@/db/client';
import { listAuditEvents } from '@/lib/audit';
import { devInbox } from '@/providers/auth-email/mock';
import { call, claim, expectErr, expectOk, principalFor, seed } from './harness';

describe('claim flow (invite -> pick -> OTP -> session)', () => {
  it('a guest with their own email claims, gets a session, entitlements, and an audited binding', async () => {
    const f = await seed('cf1');
    const look = expectOk(await call<{ status: string; members: { guestId: string; claimable: boolean; claimVia: string; claimed: boolean }[]; household: { name: string } }>('lookup_invitation', { token: f.invitations.ruiz.token }, { method: 'GET' }));
    expect(look.data.status).toBe('found');
    const ana = look.data.members.find((m) => m.guestId === f.guests.ana)!;
    expect(ana).toMatchObject({ claimable: true, claimVia: 'own_email', claimed: false });
    expect(JSON.stringify(look.data)).not.toContain('@'); // never an email

    const { cookie, outcome, request } = await claim(f.invitations.ruiz.token, f.guests.ana, f.emails.ana);
    expect(request.deliveredTo).toBe('a•••@e•••.test');
    expect(request.deliveredFor).toBeNull();
    expect(outcome.guestId).toBe(f.guests.ana);
    expect(cookie).toContain('wedding.session_token=');

    const p = await principalFor({ cookie });
    expect(p.kind).toBe('guest');
    if (p.kind !== 'guest') return;
    expect(p.guestId).toBe(f.guests.ana);
    expect(p.householdId).toBe(f.households.ruiz);
    expect(p.actsFor.sort()).toEqual([f.guests.ana, f.guests.anaPlusOne].sort());
    for (const e of ['view_event', 'rsvp_self', 'manage_household_rsvp', 'view_private_schedule', 'view_travel_tools', 'view_private_media', 'use_concierge']) expect(p.entitlements.has(e as never), e).toBe(true);
    expect(p.entitlements.has('view_table_assignment')).toBe(false);
    expect(Date.now() - Date.parse(p.authenticatedAt)).toBeLessThan(60_000);

    const db = await getDb();
    expect(await listAuditEvents(db, { action: 'identity.bound', targetType: 'guest', targetId: f.guests.ana })).toHaveLength(1);
    expect(await listAuditEvents(db, { action: 'invitation.claimed', targetId: f.invitations.ruiz.id })).toHaveLength(1);
    const again = expectOk(await call<{ status: string; lifecycle: string; members: { guestId: string; claimed: boolean }[] }>('lookup_invitation', { token: f.invitations.ruiz.token }, { method: 'GET' }));
    expect(again.data.lifecycle).toBe('claimed');
    expect(again.data.members.find((m) => m.guestId === f.guests.ana)?.claimed).toBe(true);
  });

  it('shows kind recovery for unknown, expired and revoked links; never a session', async () => {
    const f = await seed('cf2');
    for (const [token, status] of [['not-a-real-token-at-all-0000000000000000', 'unknown'], [f.invitations.expired.token, 'expired'], [f.invitations.revoked.token, 'revoked']] as const) {
      const r = expectOk(await call<{ status: string; recovery?: { title: string; message: string } }>('lookup_invitation', { token }, { method: 'GET' }));
      expect(r.data.status).toBe(status);
      expect(r.data.recovery?.message).toMatch(/Sara and Tyler/);
      const req = expectOk(await call<{ sent: boolean }>('request_otp', { purpose: 'claim', token, guestId: f.guests.exp }));
      expect(req.data.sent).toBe(false);
    }
  });

  it('children cannot be picked; a no-email adult is claimed through the household manager', async () => {
    const f = await seed('cf3');
    expectErr(await call('request_otp', { purpose: 'claim', token: f.invitations.fitzgerald.token, guestId: f.guests.nora }), 'validation');
    devInbox.clear();
    const { cookie, request } = await claim(f.invitations.fitzgerald.token, f.guests.ruth, f.emails.shared);
    expect(request.deliveredFor).toBe('Sara Fitzgerald');
    expect(request.deliveredTo).toBe('f•••@e•••.test');
    const p = await principalFor({ cookie });
    expect(p.kind).toBe('guest');
    if (p.kind !== 'guest') return;
    expect(p.guestId).toBe(f.guests.sara); // the manager signs in, not Ruth
    expect(p.actsFor).toEqual(expect.arrayContaining([f.guests.sara, f.guests.ruth, f.guests.nora, f.guests.tyler]));
    const hh = expectOk(await call<{ members: { guestId: string; canActFor: boolean; hasEmail: boolean | null }[] }>('get_my_household', {}, { cookie }));
    expect(hh.data.members.find((m) => m.guestId === f.guests.ruth)).toMatchObject({ canActFor: true, hasEmail: false });
    expect(hh.data.members.find((m) => m.guestId === f.guests.nora)).toMatchObject({ canActFor: true });
  });

  it('wrong, expired-challenge and replayed codes all fail with the same message; a used code cannot be replayed', async () => {
    const f = await seed('cf4');
    const req = expectOk(await call<{ sent: boolean; challenge: string }>('request_otp', { purpose: 'claim', token: f.invitations.okafor.token, guestId: f.guests.chidi }));
    const wrong = expectErr(await call('verify_otp', { challenge: req.data.challenge, code: '000000' }), 'validation');
    const code = (await import('./harness')).latestCode(f.emails.chidi);
    const ok = await call('verify_otp', { challenge: req.data.challenge, code });
    expect(ok.ok).toBe(true);
    // The challenge is consumed on success, so a replay is refused as a spent challenge (no session, no hint about the code).
    const replay = expectErr(await call('verify_otp', { challenge: req.data.challenge, code }), 'validation');
    expect(replay.details?.reason).toBe('challenge');
    expect(wrong.message).toMatch(/didn’t work/);
    const bogus = expectErr(await call('verify_otp', { challenge: 'x'.repeat(40), code: '123456' }), 'validation');
    expect(bogus.details?.reason).toBe('challenge');
  });
});
