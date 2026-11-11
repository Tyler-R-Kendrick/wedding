import { describe, expect, it } from 'vitest';
import { cookieValue, mintViewRoleToken, verifyViewRoleToken, viewRoleLabel } from '@/domain/identity/view-role';

const SECRET = 'unit-secret-not-real';
const NOW = new Date('2026-09-27T12:00:00Z');

describe('view-role token', () => {
  it('verifies for the session that minted it, until it expires', () => {
    const { token, expiresAt } = mintViewRoleToken('guest', 'session-a', SECRET, NOW, 60);
    expect(verifyViewRoleToken(token, 'session-a', SECRET, NOW)).toEqual({ role: 'guest' });
    expect(expiresAt).toBe('2026-09-27T12:01:00.000Z');
    expect(verifyViewRoleToken(token, 'session-a', SECRET, new Date(NOW.getTime() + 60_000))).toBeNull();
  });

  it('rejects another session, secret, or tampering', () => {
    const { token } = mintViewRoleToken('plus_one', 'session-a', SECRET, NOW);
    const [role, exp, sig] = token.split('.');
    expect(verifyViewRoleToken(token, 'session-b', SECRET, NOW)).toBeNull();
    expect(verifyViewRoleToken(`guest.${exp}.${sig}`, 'session-a', SECRET, NOW)).toBeNull();
    expect(verifyViewRoleToken(`${role}.${Number(exp) + 3600}.${sig}`, 'session-a', SECRET, NOW)).toBeNull();
  });

  it('labels roles for the UI', () => {
    expect(viewRoleLabel('party')).toBe('Wedding party');
  });
});

describe('cookieValue', () => {
  it('reads view-role cookie', () => {
    expect(cookieValue('view-role=abc.1.sig; a=1', 'view-role')).toBe('abc.1.sig');
  });
});
