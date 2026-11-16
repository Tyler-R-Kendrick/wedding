import { describe, expect, it } from 'vitest';
import { mintReporterPass, PASS_SECONDS, readReporterPass, reporterPassCookie, reporterPassSecret } from '@/lib/feedback/pass';
import { cookieValue, ownerAdminId } from '@/lib/feedback/reporter';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';

const SECRET = 'a-secret-of-at-least-sixteen-chars';
const NOW = 1_800_000_000_000;

describe('the reporter pass', () => {
  it('names the owner it was minted for, with nothing but the secret and a clock', () => {
    const pass = mintReporterPass(SECRET, 'ADMIN_01HZX', NOW)!;
    expect(readReporterPass(SECRET, pass, NOW + 1_000)).toEqual({ adminId: 'ADMIN_01HZX' });
  });

  it('expires after thirty days', () => {
    const pass = mintReporterPass(SECRET, 'ADMIN_01HZX', NOW)!;
    expect(readReporterPass(SECRET, pass, NOW + (PASS_SECONDS - 1) * 1000)).not.toBeNull();
    expect(readReporterPass(SECRET, pass, NOW + PASS_SECONDS * 1000)).toBeNull();
  });

  it('is refused under another secret, for another admin, or with a later expiry', () => {
    const pass = mintReporterPass(SECRET, 'ADMIN_01HZX', NOW)!;
    const [v, admin, expires, signature] = pass.split('.');
    expect(readReporterPass('a-different-secret-entirely', pass, NOW)).toBeNull();
    expect(readReporterPass(SECRET, [v, 'ADMIN_OTHER', expires, signature].join('.'), NOW)).toBeNull();
    expect(readReporterPass(SECRET, [v, admin, String(Number(expires) + 86_400), signature].join('.'), NOW)).toBeNull();
  });

  it('is refused when malformed, missing, or when there is no secret to check it with', () => {
    for (const token of [undefined, null, '', 'v1.x', 'v2.ADMIN_01HZX.1.abc', 'not a token']) expect(readReporterPass(SECRET, token, NOW)).toBeNull();
    expect(readReporterPass(undefined, mintReporterPass(SECRET, 'ADMIN_01HZX', NOW), NOW)).toBeNull();
    expect(mintReporterPass('', 'ADMIN_01HZX', NOW)).toBeNull();
    expect(mintReporterPass(SECRET, 'bad id!', NOW)).toBeNull();
  });

  it('has no fallback secret in production', () => {
    expect(reporterPassSecret({ NODE_ENV: 'production' })).toBeUndefined();
    expect(reporterPassSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRET })).toBe(SECRET);
    expect(reporterPassSecret({ NODE_ENV: 'development' })).toBeTruthy();
  });

  it('is an httpOnly, same-site cookie, Secure over https, and cleared with Max-Age=0', () => {
    expect(reporterPassCookie('wedding.reporter', 'tok', { secure: true })).toBe(`wedding.reporter=tok; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${PASS_SECONDS}`);
    expect(reporterPassCookie('wedding.reporter', null, { secure: false })).toBe('wedding.reporter=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  });
});

describe('who may report', () => {
  const session = { authIdentityId: 'A' as AuthIdentityId, entitlements: new Set<never>(), authenticatedAt: new Date(NOW).toISOString(), sessionId: 's' };
  const admin = (roles: ('owner' | 'planner' | 'moderator')[]): Principal => ({ kind: 'admin', adminId: 'ADMIN_1' as AdminId, roles: new Set(roles), ...session });
  const guest = (viewedBy?: ('owner' | 'planner')[]): Principal => ({
    kind: 'guest',
    guestId: 'G' as GuestId,
    householdId: 'H' as HouseholdId,
    actsFor: [],
    ...session,
    ...(viewedBy ? { viewedBy: { adminId: 'ADMIN_2' as AdminId, roles: new Set(viewedBy), readOnly: true } } : {}),
  });

  it('is an owner, and an owner browsing as a guest', () => {
    expect(ownerAdminId(admin(['owner']))).toBe('ADMIN_1');
    expect(ownerAdminId(guest(['owner']))).toBe('ADMIN_2');
  });

  it('is not the planner, a moderator, a guest, or nobody', () => {
    expect(ownerAdminId(admin(['planner', 'moderator']))).toBeNull();
    expect(ownerAdminId(guest(['planner']))).toBeNull();
    expect(ownerAdminId(guest())).toBeNull();
    expect(ownerAdminId({ kind: 'anonymous' })).toBeNull();
    expect(ownerAdminId({ kind: 'system', component: 'jobs' })).toBeNull();
  });

  it('reads one cookie out of a header without confusing similar names', () => {
    const request = new Request('https://kendrick.wedding/', { headers: { cookie: 'x-wedding.reporter=no; wedding.reporter=yes; other=1' } });
    expect(cookieValue(request, 'wedding.reporter')).toBe('yes');
    expect(cookieValue(new Request('https://kendrick.wedding/'), 'wedding.reporter')).toBeUndefined();
  });
});
