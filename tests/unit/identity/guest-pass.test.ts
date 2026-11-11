import { describe, expect, it } from 'vitest';
import { GUEST_PASS_SLUG_PATTERN, guestPassUrl, isGuestPassSlugShape } from '@/domain/identity/guest-pass';
import { randomNumericCode, randomToken } from '@/lib/crypto';

describe('guest sign-in pass tokens', () => {
  it('slug is opaque and not derived from the code', () => {
    const code = randomNumericCode(6);
    const slug = randomToken(12);
    expect(isGuestPassSlugShape(slug)).toBe(true);
    expect(slug).not.toContain(code);
    expect(guestPassUrl('https://kendrick.wedding', slug)).toBe(`https://kendrick.wedding/s/${slug}`);
    expect(GUEST_PASS_SLUG_PATTERN.test('too-short')).toBe(false);
  });
});
