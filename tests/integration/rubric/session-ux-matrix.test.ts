import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_COPY } from '@/app/(auth)/_lib/errors';
import { SAVE_THE_DATE_COPY } from '@/app/(auth)/_lib/guest-auth-copy';

const FORBIDDEN_MEMBERSHIP_PHRASES: readonly RegExp[] = [/guest list/i, /couldn't find you/i, /could not find you/i];
import { GUEST_SAVE_THE_DATE_PATH } from '@/domain/identity/guest-sign-in-paths';
import { GUEST_SIGN_IN_FAIL_PATH } from '@/domain/identity/social/complete';

describe('session & UX rubric (U)', () => {
  it('U-01: failed social sign-in redirects to save-the-date (no error query)', () => {
    expect(GUEST_SIGN_IN_FAIL_PATH).toBe(GUEST_SAVE_THE_DATE_PATH);
    expect(GUEST_SIGN_IN_FAIL_PATH).not.toContain('error=');
    const corpus = Object.values(SAVE_THE_DATE_COPY).join(' ');
    for (const re of FORBIDDEN_MEMBERSHIP_PHRASES) expect(corpus, re.source).not.toMatch(re);
  });

  it('U-03: error copy strings are plain text suitable for Notice announcements', () => {
    for (const v of Object.values(ERROR_COPY)) {
      expect(v).not.toMatch(/<[^>]+>/);
      expect(v!.trim().length).toBeGreaterThan(4);
    }
  });

  it('U-04: sign-in failure path is mobile-first auth shell (390px contract)', () => {
    const kit = readFileSync('src/app/(auth)/_components/kit.tsx', 'utf8');
    expect(GUEST_SIGN_IN_FAIL_PATH).toBe('/sign-in/save-the-date');
    expect(GUEST_SIGN_IN_FAIL_PATH.startsWith('/sign-in')).toBe(true);
    expect(kit).toMatch(/390px first/i);
    expect(kit).toContain('auth-shell');
  });
});
