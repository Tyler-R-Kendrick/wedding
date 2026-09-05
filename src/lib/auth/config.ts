import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { authAccounts, authPasskeys, authSessions, authUsers, authVerifications } from '@/db/schema';
import { OTP_POLICY } from '@/domain/identity/otp';
import { env, publicEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { OtpPurpose } from '@/providers/auth-email/types';
import { getProvider } from '@/providers/registry';
import { weddingCookies } from './cookies';

export const DEV_AUTH_SECRET = 'dev-only-better-auth-secret-change-me';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
export const SESSION_FRESH_AGE_SECONDS = 5 * 60;
export const OTP_PURPOSE_HEADER = 'x-wedding-otp-purpose';
export const AUTH_COOKIE_PREFIX = 'wedding';
export const RP_NAME = 'Sara + Tyler';

/**
 * Better Auth HTTP paths that stay closed. Every OTP/claim step runs through the capability
 * layer (enumeration resistance, rate limits, lockout, audit); Better Auth only serves
 * session reads, sign-out, and the passkey ceremonies its client needs.
 */
export const DISABLED_AUTH_PATHS = [
  '/sign-up/email',
  '/sign-in/email',
  '/sign-in/email-otp',
  '/email-otp/send-verification-otp',
  '/email-otp/verify-email',
  '/email-otp/check-verification-otp',
  '/email-otp/request-password-reset',
  '/email-otp/reset-password',
  '/email-otp/request-email-change',
  '/email-otp/change-email',
  '/forget-password',
  '/reset-password',
  '/change-password',
  '/set-password',
  '/change-email',
  '/update-user',
  '/delete-user',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
];

export function resolveAuthSecret(): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (env.isProduction) throw new Error('BETTER_AUTH_SECRET is required in production');
  if (!env.isTest) logger.warn('BETTER_AUTH_SECRET is not set; using the development default');
  return DEV_AUTH_SECRET;
}

export function siteOrigin(): string {
  return (env.BETTER_AUTH_URL ?? publicEnv.siteUrl).replace(/\/+$/, '');
}

/** Passkey relying-party id: the registrable domain of the public origin. */
export function relyingPartyId(): string {
  try {
    return new URL(siteOrigin()).hostname;
  } catch {
    return 'localhost';
  }
}

const purposeFor = (type: string, hinted: string | null): OtpPurpose => {
  if (hinted === 'step_up' || hinted === 'admin_sign_in' || hinted === 'bind_identity' || hinted === 'sign_in') return hinted;
  return type === 'change-email' ? 'bind_identity' : 'sign_in';
};

export function createAuth(db: Db) {
  const baseURL = env.BETTER_AUTH_URL
    ? env.BETTER_AUTH_URL
    : { allowedHosts: ['localhost', 'localhost:*', '127.0.0.1', '127.0.0.1:*'], fallback: publicEnv.siteUrl, protocol: 'http' as const };
  const trustedOrigins = [...new Set([publicEnv.siteUrl, env.BETTER_AUTH_URL].filter((v): v is string => !!v).map((v) => v.replace(/\/+$/, '')))];
  const rateLimit = getProvider('rate-limit', { db });

  return betterAuth({
    appName: RP_NAME,
    baseURL,
    basePath: '/api/auth',
    secret: resolveAuthSecret(),
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, passkey: authPasskeys },
    }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: SESSION_FRESH_AGE_SECONDS,
      additionalFields: {
        authenticatedAt: { type: 'date', required: false, input: false },
        activeGuestId: { type: 'string', required: false, input: false },
      },
    },
    user: { deleteUser: { enabled: false } },
    advanced: {
      useSecureCookies: env.isProduction,
      cookiePrefix: AUTH_COOKIE_PREFIX,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      database: { generateId: () => newId() },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customStorage: {
        consume: async (key, rule) => {
          const d = await rateLimit.consume(`ba:${key}`, { capacity: rule.max, refillPerSecond: rule.max / rule.window });
          return { allowed: d.allowed, retryAfter: d.allowed ? null : Math.ceil((d.retryAfterMs ?? 1000) / 1000) };
        },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Possession was just proven (OTP or passkey): stamp the server clock for step-up freshness.
          before: async (session) => ({ data: { ...session, authenticatedAt: new Date() } }),
        },
      },
    },
    disabledPaths: DISABLED_AUTH_PATHS,
    plugins: [
      emailOTP({
        otpLength: OTP_POLICY.digits,
        expiresIn: OTP_POLICY.expiresInSeconds,
        allowedAttempts: OTP_POLICY.attemptsPerCode,
        storeOTP: 'hashed',
        disableSignUp: false,
        changeEmail: { enabled: true, verifyCurrentEmail: false },
        async sendVerificationOTP({ email, otp, type }, ctx) {
          const hinted = ctx?.headers?.get?.(OTP_PURPOSE_HEADER) ?? null;
          const result = await getProvider('auth-email').sendOtp({ to: email, code: otp, purpose: purposeFor(type, hinted), expiresInMinutes: OTP_POLICY.expiresInSeconds / 60 });
          if (!result.ok) logger.warn({ provider: result.error.provider, class: result.error.class }, 'otp email could not be sent');
        },
      }),
      passkey({
        rpID: relyingPartyId(),
        rpName: RP_NAME,
        origin: env.BETTER_AUTH_URL ? [siteOrigin()] : null,
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      }),
      weddingCookies(),
    ],
  });
}

export type WeddingAuth = ReturnType<typeof createAuth>;
