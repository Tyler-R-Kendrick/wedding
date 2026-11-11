/**
 * How a server process starts (src/instrumentation.ts). Production starts lazily: nothing heavy is
 * loaded until a request needs it. It starts eagerly only when it has something that the eager
 * start alone does: a boot seed (`DB_AUTO_SEED`), or a TEST_AUTH_SECRET, which the eager path
 * exists to refuse. Development and test always start eagerly.
 */
export function startsLazily(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production' && !env.TEST_AUTH_SECRET && !env.DB_AUTO_SEED;
}

/**
 * What the keep-warm tick asks for (src/app/api/warm/route.ts): the pages a guest lands on. Each
 * route is its own function on Vercel and each one starts cold after a quiet spell, so warming one
 * does nothing for the next.
 */
export const WARM_PATHS = ['/', '/sign-in', '/guests', '/guests/travel', '/guests/ask-us', '/our-venue', '/rsvp', '/api/session'] as const;
