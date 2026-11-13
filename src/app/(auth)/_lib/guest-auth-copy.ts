/**
 * Guest-facing auth copy. Never implies whether someone is on the invitation list —
 * failures use the same warm save-the-date guidance as neutral outcomes.
 */

import { GUEST_SAVE_THE_DATE_PATH } from '@/domain/identity/guest-sign-in-paths';

export { GUEST_SAVE_THE_DATE_PATH };

export const SAVE_THE_DATE_COPY = {
  eyebrow: 'Thanks for stopping by',
  title: 'Keep an eye on your save-the-date',
  body: "We're so glad you visited. Your save-the-date will arrive with everything you need to celebrate with us.",
  tryOther: 'You can try signing in with a different email or mobile number anytime — we show everyone the same sign-in options.',
} as const;

/** Shown on /sign-in for every visitor (known or unknown). */
export const SIGN_IN_CODE_PROMISE_EMAIL =
  'If this matches our records, you’ll get a six-digit code within about a minute.';
export const SIGN_IN_CODE_PROMISE_PHONE =
  'If this matches our records, we’ll text you a six-digit code within about a minute.';
export const SIGN_IN_SAVE_THE_DATE_NOTE =
  'Still waiting on details? Your save-the-date will have what you need — there’s no rush.';
