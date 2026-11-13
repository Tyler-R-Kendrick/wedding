import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_COPY } from '@/app/(auth)/_lib/errors';
import { SAVE_THE_DATE_COPY, SIGN_IN_CODE_PROMISE_EMAIL, SIGN_IN_CODE_PROMISE_PHONE, SIGN_IN_SAVE_THE_DATE_NOTE } from '@/app/(auth)/_lib/guest-auth-copy';

const FORBIDDEN_MEMBERSHIP_PHRASES: readonly RegExp[] = [
  /guest list/i,
  /\bon the list\b/i,
  /\bnot on the\b/i,
  /couldn't find you/i,
  /could not find you/i,
  /not found on (the )?guest/i,
  /aren't on the/i,
  /are not on the/i,
  /weren't invited/i,
  /not invited/i,
];
import { GUEST_SAVE_THE_DATE_PATH } from '@/domain/identity/guest-sign-in-paths';

const AUTH_GUEST_PATHS = [
  'src/app/(auth)/_lib/errors.ts',
  'src/app/(auth)/_lib/guest-auth-copy.ts',
  'src/app/(auth)/sign-in/page.tsx',
  'src/app/(auth)/sign-in/save-the-date/page.tsx',
  'src/app/(auth)/claim/verify/page.tsx',
  'src/app/(public)/_components/PrivacyDocument.tsx',
];

describe('G6: guest-facing auth copy never reveals list membership', () => {
  it('G6: save-the-date path is stable and not an error query', () => {
    expect(GUEST_SAVE_THE_DATE_PATH).toBe('/sign-in/save-the-date');
    expect(GUEST_SAVE_THE_DATE_PATH).not.toContain('error=');
  });

  it('G6: ERROR_COPY has no guest-list wording', () => {
    const corpus = Object.values(ERROR_COPY).join('\n');
    for (const re of FORBIDDEN_MEMBERSHIP_PHRASES) expect(corpus, re.source).not.toMatch(re);
  });

  it('G6: save-the-date copy is warm and mentions save-the-date', () => {
    const corpus = [Object.values(SAVE_THE_DATE_COPY), SIGN_IN_CODE_PROMISE_EMAIL, SIGN_IN_CODE_PROMISE_PHONE, SIGN_IN_SAVE_THE_DATE_NOTE].flat().join(' ');
    expect(corpus).toMatch(/save-the-date/i);
    for (const re of FORBIDDEN_MEMBERSHIP_PHRASES) expect(corpus, re.source).not.toMatch(re);
  });

  it('G6: primary auth surfaces avoid forbidden membership phrases', () => {
    const root = process.cwd();
    const corpus = AUTH_GUEST_PATHS.map((rel) => readFileSync(path.join(root, rel), 'utf8')).join('\n');
    for (const re of FORBIDDEN_MEMBERSHIP_PHRASES) expect(corpus, re.source).not.toMatch(re);
  });

  it('G6: no guest_not_found key in ERROR_COPY', () => {
    expect('guest_not_found' in ERROR_COPY).toBe(false);
  });
});
