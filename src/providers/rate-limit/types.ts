import type { ProviderDescriptor } from '@/contracts/providers';

export interface RateLimitPolicy {
  /** Bucket size (burst). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** Present when denied. */
  retryAfterMs?: number;
}

/** Named policies shared across surfaces. Keys are namespaced by the caller (e.g. `cap:<principal>`). */
export const RATE_LIMIT_POLICIES = {
  /** Capability calls per principal (or per IP for anonymous callers). */
  capability: { capacity: 60, refillPerSecond: 1 },
  /** Coarse per-IP guard applied before the body is read or the session resolved (shared NATs are generous). */
  capabilityIp: { capacity: 200, refillPerSecond: 5 },
  /** OTP sends per identifier. */
  otp: { capacity: 5, refillPerSecond: 5 / 600 },
  /** OTP verification attempts per identifier. */
  otpVerify: { capacity: 10, refillPerSecond: 10 / 600 },
  /** Uploads per guest. */
  upload: { capacity: 30, refillPerSecond: 30 / 3600 },
  /** Concierge messages per principal. */
  concierge: { capacity: 20, refillPerSecond: 20 / 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export interface RateLimitProvider extends ProviderDescriptor {
  kind: 'rate-limit';
  consume(key: string, policy: RateLimitPolicy | RateLimitPolicyName, cost?: number): Promise<RateLimitDecision>;
  /** Tests/admin: forget a key. */
  reset(key: string): Promise<void>;
}

export function resolvePolicy(policy: RateLimitPolicy | RateLimitPolicyName): RateLimitPolicy {
  return typeof policy === 'string' ? RATE_LIMIT_POLICIES[policy] : policy;
}

/** Pure token-bucket step shared by both implementations. */
export function stepBucket(tokens: number, updatedAtMs: number, nowMs: number, policy: RateLimitPolicy, cost: number): { tokens: number; decision: RateLimitDecision } {
  const elapsed = Math.max(0, nowMs - updatedAtMs) / 1000;
  const refilled = Math.min(policy.capacity, tokens + elapsed * policy.refillPerSecond);
  if (refilled >= cost) {
    const next = refilled - cost;
    return { tokens: next, decision: { allowed: true, remaining: Math.floor(next) } };
  }
  const deficit = cost - refilled;
  const retryAfterMs = policy.refillPerSecond > 0 ? Math.ceil((deficit / policy.refillPerSecond) * 1000) : Number.MAX_SAFE_INTEGER;
  return { tokens: refilled, decision: { allowed: false, remaining: 0, retryAfterMs } };
}
