import { AsyncLocalStorage } from 'node:async_hooks';
import { createAuthMiddleware } from 'better-auth/api';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';

/**
 * Delivers Set-Cookie headers produced by server-side `auth.api.*` calls.
 *  1. Into the ambient `CookieSink` (AsyncLocalStorage) when a capability runs inside
 *     `withCookieSink` — route handlers and tests collect cookies this way.
 *  2. Into Next.js `cookies()` when a request scope exists (server actions, route handlers),
 *     mirroring Better Auth's `nextCookies()` plugin; silently skipped outside a request.
 * Cookies never leave the server any other way, so a capability response body never carries
 * a session token.
 */
export interface CookieSink {
  setCookies: string[];
}

const storage = new AsyncLocalStorage<CookieSink>();

export function withCookieSink<T>(sink: CookieSink, fn: () => Promise<T>): Promise<T> {
  return storage.run(sink, fn);
}

export function currentCookieSink(): CookieSink | undefined {
  return storage.getStore();
}

let nextHeaders: Promise<typeof import('next/headers')> | undefined;
const loadNextHeaders = () => (nextHeaders ??= import('next/headers').catch((e) => { nextHeaders = undefined; throw e; }));

export function weddingCookies() {
  return {
    id: 'wedding-cookies',
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            if ('_flag' in ctx && (ctx as { _flag?: string })._flag === 'router') return;
            const returned = ctx.context.responseHeaders;
            if (!(returned instanceof Headers)) return;
            const setCookies = returned.getSetCookie?.() ?? (returned.get('set-cookie') ? [returned.get('set-cookie')!] : []);
            if (setCookies.length === 0) return;
            const sink = storage.getStore();
            if (sink) sink.setCookies.push(...setCookies);
            let store: Awaited<ReturnType<Awaited<ReturnType<typeof loadNextHeaders>>['cookies']>> | undefined;
            try {
              const { cookies } = await loadNextHeaders();
              store = await cookies();
            } catch {
              return;
            }
            const parsed = parseSetCookieHeader(setCookies.join(', '));
            parsed.forEach((value, key) => {
              if (!key) return;
              try {
                store!.set(key, value.value, toCookieOptions(value));
              } catch {
                // Read-only cookie store (RSC render): the sink still received the cookies.
              }
            });
          }),
        },
      ],
    },
  };
}

/** Applies collected Set-Cookie headers onto an outgoing Response (route handlers). */
export function applyCookieSink(sink: CookieSink, headers: Headers): void {
  for (const c of sink.setCookies) headers.append('set-cookie', c);
}
