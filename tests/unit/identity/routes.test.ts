import { describe, expect, it } from 'vitest';
import { isInternalRoute } from '@/capabilities/routes';
import { isSafeReturnPath, safeReturnPath } from '@/domain/identity/routes';
import { errorCode, errorCopy, ERROR_COPY } from '@/app/(auth)/_lib/errors';

describe('safe return paths (review S7/N4)', () => {
  it('accepts same-site public, auth and admin paths', () => {
    for (const p of ['/', '/rsvp', '/guests', '/guests/travel', '/guests/things-to-do', '/guests/things-to-do/starved-rock-state-park', '/guests/ask-us', '/guests/ask-us?q=dress', '/transportation', '/trip', '/gifts', '/photos', '/sign-in', '/sign-in/admin', '/step-up', '/claim/welcome', '/claim/welcome?contact=1', '/invite/AbC-_123', '/i/xyz', '/admin', '/admin/guests', '/admin/invitations?ok=1', '/our-adventures/starved-rock', '/our-venue', '/our-venue/white-city-ballroom', '/rsvp/attending', '/rsvp/meals', "/media/search?q=Sara's%20dress", '/media/search?q=(first)%20dance!']) {
      expect(isSafeReturnPath(p), p).toBe(true);
    }
  });
  it('still honours the address a page had before it moved into the guest portal', () => {
    // A sign-in link minted before the move carries the old path as `next`; next.config.ts redirects it.
    for (const p of ['/your-weekend', '/the-wedding', '/travel', '/travel?from=home', '/share-an-adventure', '/share-an-adventure/starved-rock-state-park', '/ask-us', '/ask-us?q=dress']) {
      expect(isSafeReturnPath(p), p).toBe(true);
    }
    // Only as return paths: they are not routes the app navigates to.
    for (const p of ['/your-weekend', '/the-wedding', '/travel', '/share-an-adventure', '/ask-us']) expect(isInternalRoute(p), p).toBe(false);
  });
  it('refuses off-site and malformed targets', () => {
    for (const p of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/sign-in/../admin', '/admin/../../x', '/invite/<script>', '/unknown', '/claim/verify#frag', '/explore-caa', '/explore-caa/white-city-ballroom', '/explore-caa/<script>', '/things-to-do', '/wedding-day', '/travel-lookalike', '/travel/<script>', '/ask-us/..', '/guests/nowhere', '/step-up?next=https://evil', '/rsvp/<x>', '/rsvp/nope', '/rsvp/meals/extra', '/media/me', ' /sign-in', '/sign-in\n', 'sign-in', '', null, undefined, 42, '/' + 'a'.repeat(600)]) {
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

describe('RSVP part routes', () => {
  it('the navigate_to allowlist names exactly the parts the RSVP has', async () => {
    const { INTERNAL_ROUTES } = await import('@/capabilities/routes');
    const { PART_STEP } = await import('@/components/rsvp/RsvpTaskList');
    const listed = INTERNAL_ROUTES.filter((r) => r.startsWith('/rsvp/')).sort();
    expect(listed).toEqual(Object.values(PART_STEP).map((s) => `/rsvp/${s}`).sort());
  });
});
