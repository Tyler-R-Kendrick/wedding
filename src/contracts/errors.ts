/**
 * Structured error classification shared by capabilities, providers, and UI.
 * `code` is stable and machine-readable; `message` is safe to show to a guest.
 * Never put secrets, OTPs, voucher codes, or other guests' data in messages.
 */
export type CapabilityErrorCode =
  | 'unauthenticated'          // no principal where one is required
  | 'forbidden'                // principal lacks entitlement / not the owner
  | 'step_up_required'         // session not fresh enough for a consequential action
  | 'confirmation_required'    // explicit confirmation token missing/expired
  | 'validation'               // input failed schema or domain validation
  | 'not_found'
  | 'conflict'                 // state machine violation, duplicate claim, etc.
  | 'rate_limited'
  | 'feature_disabled'         // behind a feature flag or legal readiness switch
  | 'provider_unavailable'     // adapter unconfigured / degraded / timed out
  | 'provider_error'           // provider returned an error we classified
  | 'stale_data'               // provenance says the data is outside its validity window
  | 'internal';

export interface CapabilityErrorShape {
  code: CapabilityErrorCode;
  message: string;
  /** Machine-readable detail for the UI (field errors, retryAfter, provider name). Safe for guests. */
  details?: Record<string, unknown>;
  /** Only set server-side for logs; stripped before leaving the capability layer. */
  cause?: unknown;
}

export class CapabilityError extends Error implements CapabilityErrorShape {
  readonly code: CapabilityErrorCode;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;
  constructor(code: CapabilityErrorCode, message: string, details?: Record<string, unknown>, cause?: unknown) {
    super(message);
    this.name = 'CapabilityError';
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
  /** Guest-safe serialization (no cause). */
  toJSON(): CapabilityErrorShape {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
  static is(e: unknown): e is CapabilityError {
    return e instanceof CapabilityError;
  }
}

export const HTTP_STATUS_FOR_CODE: Record<CapabilityErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  step_up_required: 403,
  confirmation_required: 409,
  validation: 422,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  feature_disabled: 404,
  provider_unavailable: 503,
  provider_error: 502,
  stale_data: 409,
  internal: 500,
};
