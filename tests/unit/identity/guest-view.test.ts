import { describe, expect, it } from 'vitest';
import { cookieValue, isAdminSurface, mintGuestViewToken, verifyGuestViewToken } from '@/domain/identity/guest-view';

const SECRET = 'unit-secret-not-real';
const NOW = new Date('2026-09-27T12:00:00Z');

describe('guest-view token', () => {
  it('verifies for the session that minted it, until it expires', () => {
    const { token, expiresAt } = mintGuestViewToken('GUEST1', 'session-a', SECRET, NOW, 60);
    expect(verifyGuestViewToken(token, 'session-a', SECRET, NOW)).toEqual({ guestId: 'GUEST1' });
    expect(expiresAt).toBe('2026-09-27T12:01:00.000Z');
    expect(verifyGuestViewToken(token, 'session-a', SECRET, new Date(NOW.getTime() + 60_000))).toBeNull();
  });

  it('means nothing to another session, another secret, or with any part changed', () => {
    const { token } = mintGuestViewToken('GUEST1', 'session-a', SECRET, NOW);
    const [id, exp, sig] = token.split('.');
    expect(verifyGuestViewToken(token, 'session-b', SECRET, NOW)).toBeNull();
    expect(verifyGuestViewToken(token, 'session-a', 'another-secret', NOW)).toBeNull();
    expect(verifyGuestViewToken(`GUEST2.${exp}.${sig}`, 'session-a', SECRET, NOW)).toBeNull();
    expect(verifyGuestViewToken(`${id}.${Number(exp) + 3600}.${sig}`, 'session-a', SECRET, NOW)).toBeNull();
    expect(verifyGuestViewToken(`${token}.extra`, 'session-a', SECRET, NOW)).toBeNull();
    for (const bad of [null, undefined, '', 'x', 'a.b', 'a.b.c', '../x.1.sig']) expect(verifyGuestViewToken(bad, 'session-a', SECRET, NOW)).toBeNull();
  });

  it('refuses to mint for a malformed guest id', () => {
    expect(() => mintGuestViewToken('a.b', 's', SECRET, NOW)).toThrow();
  });
});

describe('the console is never viewed as a guest', () => {
  it.each(['/admin', '/admin/guests', '/admin/rsvp/export', '/api/capabilities/admin_list_guests', '/api/webmcp/invoke/admin_list_guests', '/step-up'])('%s', (path) => expect(isAdminSurface(path)).toBe(true));
  it.each(['/', '/your-weekend', '/rsvp', '/administrator', '/api/session', '/api/capabilities/get_my_rsvp'])('%s is the site', (path) => expect(isAdminSurface(path)).toBe(false));
});

describe('cookieValue', () => {
  it('reads one cookie by exact name', () => {
    expect(cookieValue('a=1; guest-view=abc.1.sig; b=2', 'guest-view')).toBe('abc.1.sig');
    expect(cookieValue('xguest-view=nope', 'guest-view')).toBeNull();
    expect(cookieValue(null, 'guest-view')).toBeNull();
  });
});
