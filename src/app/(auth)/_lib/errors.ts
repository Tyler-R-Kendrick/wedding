/**
 * Fixed, first-party copy for every error a journey can surface. Actions pass a short code in
 * the URL; pages never render attacker-influenced text (review N7).
 */
export const ERROR_COPY: Record<string, string> = {
  pick: 'Please choose your name to continue.',
  code: 'That code didn’t work. Check the digits and try again, or request a new code.',
  expired: 'That code has expired. Request a new one and we’ll send it right away.',
  locked: 'Too many incorrect codes. For your security, please wait 15 minutes and request a new code.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  validation: 'Please check what you entered and try again.',
  no_email: 'We don’t have an email address for anyone in this household yet. Reach out to Sara and Tyler and they will set it up.',
  unlinked: 'That email isn’t linked to an invitation yet. Open the link Sara and Tyler sent you, or get in touch with them.',
  unauthenticated: 'Please sign in to continue.',
  forbidden: 'That isn’t available for your invitation. If you think it should be, get in touch with Sara and Tyler.',
  conflict: 'That person has already claimed their invitation with another email. If that’s wrong, please get in touch with Sara and Tyler.',
  step_up_required: 'For your security, please confirm it’s you first.',
  provider_unavailable: 'We couldn’t send the code just now. Please try again in a moment.',
  internal: 'Something went wrong on our side. Please try again in a moment.',
};

export function errorCopy(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_COPY[code] ?? ERROR_COPY.internal!;
}

/** Maps a capability error to a copy code (only ever a key of ERROR_COPY). */
export function errorCode(error: { code: string; details?: Record<string, unknown>; message?: string }): string {
  if (error.code === 'validation') {
    const reason = error.details?.reason;
    if (reason === 'expired' || reason === 'challenge') return 'expired';
    if (error.details?.issues) return 'code';
    return 'validation';
  }
  if (error.code === 'rate_limited' && typeof error.message === 'string' && /incorrect codes/.test(error.message)) return 'locked';
  return error.code in ERROR_COPY ? error.code : 'internal';
}
