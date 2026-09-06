import { describe, expect, it } from 'vitest';
import { isSafeReturnPath, safeReturnPath } from '@/domain/identity/routes';
import { errorCode, errorCopy, ERROR_COPY } from '@/app/(auth)/_lib/errors';

describe('safe return paths (review S7/N4)', () => {
  it('accepts same-site public, auth and admin paths', () => {
    for (const p of ['/', '/your-weekend', '/rsvp', '/sign-in', '/sign-in/admin', '/step-up', '/claim/welcome', '/claim/welcome?contact=1', '/invite/AbC-_123', '/i/xyz', '/admin', '/admin/guests', '/admin/invitations?ok=1', '/our-adventures/starved-rock']) {
      expect(isSafeReturnPath(p), p).toBe(true);
    }
  });
  it('refuses off-site and malformed targets', () => {
    for (const p of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/sign-in/../admin', '/admin/../../x', '/invite/<script>', '/unknown', '/claim/verify#frag', '/step-up?next=https://evil', ' /sign-in', '/sign-in\n', 'sign-in', '', null, undefined, 42, '/' + 'a'.repeat(600)]) {
      expect(isSafeReturnPath(p), String(p)).toBe(false);
    }
    expect(safeReturnPath('https://evil.example', '/sign-in')).toBe('/sign-in');
    expect(safeReturnPath('/admin/guests', '/sign-in')).toBe('/admin/guests');
  });
});

describe('fixed error copy (review N7)', () => {
  it('maps every capability error to first-party text and never echoes messages', () => {
    expect(errorCopy('code')).toBe(ERROR_COPY.code);
    expect(errorCopy('not-a-code')).toBe(ERROR_COPY.internal);
    expect(errorCopy(undefined)).toBeNull();
    expect(errorCode({ code: 'validation', details: { reason: 'challenge' } })).toBe('expired');
    expect(errorCode({ code: 'validation', details: { issues: [] } })).toBe('code');
    expect(errorCode({ code: 'rate_limited', message: 'Too many incorrect codes. For your security, please wait 15 minutes' })).toBe('locked');
    expect(errorCode({ code: 'rate_limited', message: 'Too many attempts.' })).toBe('rate_limited');
    expect(errorCode({ code: 'weird' })).toBe('internal');
    for (const v of Object.values(ERROR_COPY)) expect(v).not.toMatch(/<|>|http/);
  });
});
