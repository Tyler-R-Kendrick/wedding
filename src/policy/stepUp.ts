import { CapabilityError } from '@/contracts/errors';
import { isSessionFresh, STEP_UP_MAX_AGE_SECONDS, type Principal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';

export const STEP_UP_MESSAGE = 'For your security, please confirm it is you before continuing.';

export function stepUpError(maxAgeSeconds = STEP_UP_MAX_AGE_SECONDS): CapabilityError {
  return new CapabilityError('step_up_required', STEP_UP_MESSAGE, { maxAgeSeconds });
}

/** Fresh-session gate for consequential actions (money, identity, external commitments). */
export function requireFreshSession(principal: Principal, now: Date = new Date(), maxAgeSeconds = STEP_UP_MAX_AGE_SECONDS): Result<void, CapabilityError> {
  if (principal.kind === 'anonymous') return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
  return isSessionFresh(principal, now, maxAgeSeconds) ? ok(undefined) : err(stepUpError(maxAgeSeconds));
}

export { isSessionFresh };
