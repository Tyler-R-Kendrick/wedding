import { describe, expect, it } from 'vitest';
import { readTestPrincipalFor, TEST_PRINCIPAL_HEADER, TEST_PRINCIPAL_SECRET_HEADER } from '@/lib/auth/test-principal';
import { discardMintedSession } from '@/capabilities/identity/shared';
import { scrubForAudit } from '@/domain/identity/audit';
import { MockAuthEmail, devInbox } from '@/providers/auth-email/mock';

const SECRET = 'test-auth-secret-0123456789abcdef';
const req = (principal: unknown, secret: string | null = SECRET) =>
  new Request('http://localhost/x', { method: 'POST', headers: { ...(secret ? { [TEST_PRINCIPAL_SECRET_HEADER]: secret } : {}), [TEST_PRINCIPAL_HEADER]: typeof principal === 'string' ? principal : JSON.stringify(principal) } });

describe('test principal injector (review N9)', () => {
  it('is honoured only under test with the exact secret; never injects system', () => {
    const guest = { kind: 'guest', guestId: 'G1', householdId: 'H1', entitlements: ['rsvp_self', 'not_real'], actsFor: ['G2'] };
    const p = readTestPrincipalFor(req(guest), { isTest: true, secret: SECRET });
    expect(p?.kind).toBe('guest');
    if (p?.kind === 'guest') {
      expect(p.guestId).toBe('G1');
      expect([...p.entitlements]).toEqual(['rsvp_self']);
      expect(p.actsFor.sort()).toEqual(['G1', 'G2']);
    }
    expect(readTestPrincipalFor(req(guest), { isTest: false, secret: SECRET })).toBeNull();
    expect(readTestPrincipalFor(req(guest), { isTest: true, secret: undefined })).toBeNull();
    expect(readTestPrincipalFor(req(guest, 'wrong-secret-0123456789abcdef'), { isTest: true, secret: SECRET })).toBeNull();
    expect(readTestPrincipalFor(req(guest, null), { isTest: true, secret: SECRET })).toBeNull();
    expect(readTestPrincipalFor(req({ kind: 'system', component: 'jobs' }), { isTest: true, secret: SECRET })).toBeNull();
    expect(readTestPrincipalFor(req('not json'), { isTest: true, secret: SECRET })).toBeNull();
    expect(readTestPrincipalFor(req({ kind: 'guest' }), { isTest: true, secret: SECRET })).toBeNull();
    const admin = readTestPrincipalFor(req({ kind: 'admin', roles: ['planner'] }), { isTest: true, secret: SECRET });
    expect(admin?.kind).toBe('admin');
    if (admin?.kind === 'admin') {
      expect(admin.entitlements.has('admin_guest_ops')).toBe(true);
      expect(admin.entitlements.has('admin_media')).toBe(false);
    }
    expect(readTestPrincipalFor(req({ kind: 'admin', roles: ['king'] }), { isTest: true, secret: SECRET })).toBeNull();
  });
});

describe('discardMintedSession (review N2)', () => {
  it('drops the minted cookie and restores the previous session cookie, or expires it when none existed', async () => {
    const sink = { setCookies: ['wedding.session_token=NEW.sig; Path=/; HttpOnly'] };
    await discardMintedSession({ headers: new Headers({ cookie: 'theme=x; wedding.session_token=OLD.sig' }), sink });
    expect(sink.setCookies).toHaveLength(1);
    expect(sink.setCookies[0]).toMatch(/^wedding\.session_token=OLD\.sig; Path=\/; HttpOnly; SameSite=Lax$/);
    const none = { setCookies: ['__Secure-wedding.session_token=NEW; Path=/'] };
    await discardMintedSession({ headers: new Headers(), sink: none });
    expect(none.setCookies[0]).toMatch(/^wedding\.session_token=; Max-Age=0/);
    const secure = { setCookies: [] as string[] };
    await discardMintedSession({ headers: new Headers({ cookie: '__Secure-wedding.session_token=OLD' }), sink: secure });
    expect(secure.setCookies[0]).toMatch(/^__Secure-wedding\.session_token=OLD; .*Secure$/);
  });
});

describe('audit scrubbing (review N1)', () => {
  it('removes addresses and caps length', () => {
    expect(scrubForAudit('lost phone, was sara@example.test now  tyler+x@ex.co')).toBe('lost phone, was [email] now [email]');
    expect(scrubForAudit('x'.repeat(300))!.length).toBe(200);
    expect(scrubForAudit(null)).toBeNull();
  });
});

describe('auth-email sendMessage (Swarm E)', () => {
  it('delivers plain messages to the dev inbox alongside codes, distinguishable by kind', async () => {
    devInbox.clear();
    const mock = new MockAuthEmail();
    expect((await mock.sendMessage({ to: 'guest@example.test', subject: 'Your RSVP', text: 'See you there.' })).ok).toBe(true);
    expect((await mock.sendOtp({ to: 'guest@example.test', code: '123456', purpose: 'sign_in' })).ok).toBe(true);
    expect(devInbox.latestFor('guest@example.test')?.code).toBe('123456');
    expect(devInbox.latestMessageFor('guest@example.test')).toMatchObject({ kind: 'message', subject: 'Your RSVP', text: 'See you there.' });
    expect(devInbox.list().map((m) => m.kind)).toEqual(['otp', 'message']);
  });
});
