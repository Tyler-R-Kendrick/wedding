import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef, type AdminPrincipal, type AdminRole, type GuestPrincipal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { hashOtpIdentifier, recordOtpAttempt } from '@/domain/identity/otp';
import { appServices } from '@/capabilities/context';
import { requireService } from '@/capabilities/services';
import { getAuth, withCookieSink, type CookieSink } from '@/lib/auth';
import { requireAdmin, requireGuest } from '@/lib/principal';
import { resolveAuthSecret } from '@/lib/auth/config';
import type { RateLimitPolicy } from '@/providers/rate-limit/types';

/**
 * Transport facts the app layer attaches to `ctx.services` for identity capabilities:
 *  - requestHeaders: the inbound request headers (cookies, origin) for Better Auth calls
 *  - clientIp: from getClientIp() (never from the input)
 *  - cookieSink: where Set-Cookie headers from session creation land
 * Server actions under src/app/(auth) and the dev fixtures route wire these; the generic
 * capability route does not, so session-creating steps refuse there (see requireCookieTransport).
 */
export interface IdentityTransport {
  requestHeaders?: Headers;
  clientIp?: string;
  cookieSink?: CookieSink;
}

export function transportOf(ctx: CapabilityContext): IdentityTransport {
  const s = ctx.services as Record<string, unknown>;
  return {
    requestHeaders: s.requestHeaders instanceof Headers ? s.requestHeaders : undefined,
    clientIp: typeof s.clientIp === 'string' ? s.clientIp : undefined,
    cookieSink: s.cookieSink && typeof s.cookieSink === 'object' && Array.isArray((s.cookieSink as CookieSink).setCookies) ? (s.cookieSink as CookieSink) : undefined,
  };
}

export const NO_COOKIE_TRANSPORT = 'Please finish this step from the sign-in page.';

/** Session-creating steps need somewhere to put the cookie; otherwise a session would be minted and lost. */
export function requireCookieTransport(ctx: CapabilityContext): Result<{ headers: Headers; sink: CookieSink }, CapabilityError> {
  const t = transportOf(ctx);
  if (!t.cookieSink && !t.requestHeaders) return err(new CapabilityError('validation', NO_COOKIE_TRANSPORT, { reason: 'no_cookie_transport' }));
  return ok({ headers: t.requestHeaders ?? new Headers(), sink: t.cookieSink ?? { setCookies: [] } });
}

export async function authOf(ctx: CapabilityContext) {
  const db = requireService<Db>(ctx, 'db');
  return { db, auth: await getAuth(db) };
}

export const challengeSecret = (): string => resolveAuthSecret();

export const ipHashOf = (ctx: CapabilityContext): string => hashOtpIdentifier(transportOf(ctx).clientIp ?? 'unknown');

/**
 * Per-email limits stop targeting one inbox; per-IP limits stop spraying. Per-IP values are
 * NAT-friendly on purpose (a hotel or a family Wi-Fi shares one address at wedding time).
 */
export const OTP_LIMITS = {
  sendPerEmail: { capacity: 5, refillPerSecond: 5 / 600, failMode: 'closed' },
  sendPerIp: { capacity: 60, refillPerSecond: 60 / 600, failMode: 'closed' },
  verifyPerEmail: { capacity: 10, refillPerSecond: 10 / 600, failMode: 'closed' },
  verifyPerIp: { capacity: 120, refillPerSecond: 120 / 600, failMode: 'closed' },
  lookupPerIp: { capacity: 120, refillPerSecond: 120 / 600, failMode: 'closed' },
} as const satisfies Record<string, RateLimitPolicy>;

export const RATE_LIMIT_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.';

/** Consumes one token from every key; the first exhausted bucket denies (all-or-nothing is not needed for abuse control). */
export async function consumeLimits(ctx: CapabilityContext, buckets: { key: string; policy: RateLimitPolicy }[]): Promise<Result<void, CapabilityError>> {
  const { db, providers } = appServices(ctx);
  const limiter = providers('rate-limit', { db });
  for (const b of buckets) {
    const d = await limiter.consume(b.key, b.policy);
    if (!d.allowed) return err(new CapabilityError('rate_limited', RATE_LIMIT_MESSAGE, { retryAfterMs: d.retryAfterMs ?? 60_000 }));
  }
  return ok(undefined);
}

export async function logOtp(ctx: CapabilityContext, input: { emailHash: string; purpose: string; kind: 'send' | 'verify'; outcome: 'sent' | 'suppressed' | 'verified' | 'failed' | 'locked' | 'rate_limited' }): Promise<void> {
  const { db } = appServices(ctx);
  try {
    await recordOtpAttempt(db, { ...input, ipHash: ipHashOf(ctx), at: ctx.now });
  } catch (e) {
    appServices(ctx).logger?.warn({ err: e }, 'otp attempt log failed');
  }
}

export interface AuthApiFailure {
  status: number;
  code: string;
  message: string;
}

/** Runs a Better Auth API call, collecting cookies into the sink and normalising APIError. */
export async function callAuth<T>(sink: CookieSink, fn: () => Promise<T>): Promise<Result<T, AuthApiFailure>> {
  try {
    return ok(await withCookieSink(sink, fn));
  } catch (e) {
    const anyErr = e as { status?: unknown; statusCode?: unknown; body?: { code?: string; message?: string }; message?: string };
    const status = typeof anyErr.statusCode === 'number' ? anyErr.statusCode : typeof anyErr.status === 'number' ? anyErr.status : 500;
    const code = anyErr.body?.code ?? (typeof anyErr.status === 'string' ? anyErr.status : 'UNKNOWN');
    return err({ status, code, message: anyErr.body?.message ?? anyErr.message ?? 'auth error' });
  }
}

export const actorOf = (ctx: CapabilityContext) => toPrincipalRef(ctx.principal);

/** Result-returning guards: the pipeline maps thrown errors to `internal`, so handlers must not throw for expected denials. */
export function guestOf(ctx: CapabilityContext): Result<GuestPrincipal, CapabilityError> {
  try {
    return ok(requireGuest(ctx.principal));
  } catch (e) {
    return err(e instanceof CapabilityError ? e : new CapabilityError('forbidden', 'You do not have access to that.'));
  }
}

export function adminOf(ctx: CapabilityContext, roles?: readonly AdminRole[]): Result<AdminPrincipal, CapabilityError> {
  try {
    return ok(requireAdmin(ctx.principal, roles));
  } catch (e) {
    return err(e instanceof CapabilityError ? e : new CapabilityError('forbidden', 'You do not have access to that.'));
  }
}

export const INVALID_CODE_MESSAGE = 'That code didn’t work. Check the digits and try again, or request a new code.';
export const EXPIRED_CODE_MESSAGE = 'That code has expired. Request a new one and we’ll send it right away.';
export const LOCKED_MESSAGE = 'Too many incorrect codes. For your security, please wait 15 minutes and request a new code.';

export const RECOVERY = {
  unknown: { title: 'We couldn’t find that invitation', message: 'The link may have been copied incompletely. Try opening it again from your invitation, or get in touch with Sara and Tyler and they will send a fresh one.' },
  expired: { title: 'This invitation link has expired', message: 'No problem — reach out to Sara and Tyler and they will send you a new link right away.' },
  revoked: { title: 'This invitation link is no longer active', message: 'A newer link was sent for your household. Check your latest message from Sara and Tyler, or ask them for a fresh one.' },
} as const;
