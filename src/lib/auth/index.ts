import { getDb, type Db } from '@/db/client';
import { setPrincipalResolver } from '@/lib/principal';
import { createAuth, type WeddingAuth } from './config';
import { betterAuthPrincipalResolver } from './resolver';

type Holder = { promise?: Promise<WeddingAuth>; installed?: boolean };
const g = globalThis as unknown as { __weddingAuth?: Holder };
const holder: Holder = g.__weddingAuth ?? (g.__weddingAuth = {});

/** Lazily builds the Better Auth instance on the app database (once per process, HMR-safe). */
export function getAuth(db?: Db): Promise<WeddingAuth> {
  holder.promise ??= (db ? Promise.resolve(db) : getDb()).then((conn) => createAuth(conn)).catch((e) => {
    holder.promise = undefined;
    throw e;
  });
  return holder.promise;
}

/** Tests: forget the instance (after resetDb). */
export function resetAuth(): void {
  holder.promise = undefined;
}

/** Installs the Better Auth-backed PrincipalResolver into src/lib/principal.ts. Idempotent. */
export function installAuthPrincipalResolver(): void {
  if (holder.installed) return;
  setPrincipalResolver(betterAuthPrincipalResolver);
  holder.installed = true;
}

installAuthPrincipalResolver();

export { betterAuthPrincipalResolver } from './resolver';
export { withCookieSink, applyCookieSink, type CookieSink } from './cookies';
export { getAuthSession, toSessionFacts, type AuthSession } from './session';
export { isTrustedMutationRequest } from './csrf';
export { OTP_PURPOSE_HEADER, siteOrigin, relyingPartyId, SESSION_FRESH_AGE_SECONDS, DISABLED_AUTH_PATHS } from './config';
