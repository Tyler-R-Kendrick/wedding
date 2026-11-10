import { siteOrigin } from '@/lib/auth/config';
import { WARM_PATHS } from '@/lib/boot-mode';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { bearerToken, getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Keeps the pages a guest lands on from going cold (vercel.json runs this every five minutes).
 *
 * Each route is its own function, and a function that has been quiet for a while starts again
 * from nothing on its next request: its process, the sign-in libraries, a database connection. A
 * wedding site is quiet most of the time, so most visits began that way. This asks for each
 * landing page once, as a browser with a session cookie would, so that the whole signed-in path is
 * loaded: the cookie names a session that does not exist, the page resolves it to nobody and
 * answers with its sign-in redirect, and the function stays up for the next real guest.
 *
 * Only the cron may call it (the same bearer as the job runners): it is ten requests to our own
 * site, and nobody else needs to be able to cause them.
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const token = bearerToken(request);
  if (!env.CRON_SECRET || !token || !timingSafeEqualString(token, env.CRON_SECRET)) {
    return jsonResponse({ ok: false, error: { code: 'unauthenticated', message: 'Unauthorized.' } }, { status: 401, requestId });
  }
  const origin = siteOrigin();
  const secure = origin.startsWith('https://');
  const cookie = `${secure ? '__Secure-' : ''}wedding.session_token=keep-warm`;
  const results = await Promise.all(
    WARM_PATHS.map(async (path) => {
      const started = performance.now();
      try {
        const response = await fetch(`${origin}${path}`, { headers: { cookie, 'user-agent': 'wedding-keep-warm' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
        return { path, status: response.status, ms: Math.round(performance.now() - started) };
      } catch {
        return { path, status: 0, ms: Math.round(performance.now() - started) };
      }
    }),
  );
  return jsonResponse({ ok: results.every((r) => r.status > 0 && r.status < 500), results }, { requestId });
}
