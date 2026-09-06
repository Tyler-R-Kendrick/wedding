import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth, isTrustedMutationRequest, siteOrigin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Better Auth's HTTP surface: session read, sign-out, passkey authentication ceremony.
 * OTP and claim paths are disabled here (see DISABLED_AUTH_PATHS) and run as capabilities.
 *
 * Cross-origin mutations are refused here rather than left to the library. The principal resolver
 * already applies `isTrustedMutationRequest`, so a foreign origin resolves to anonymous everywhere
 * else — but this route hands the request straight to Better Auth's own handler and never builds a
 * principal, so it was not covered. Measured before adding this: `POST /api/auth/sign-out` carrying
 * `Origin: https://evil.example` answered 200, a cross-site forced sign-out. The security suite
 * asserted that was blocked; it was not, because that suite had never run in CI.
 */
const handler = async (request: Request) => {
  if (!isTrustedMutationRequest(request, [siteOrigin()])) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed' }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  return (await getAuth()).handler(request);
};

export const { GET, POST } = toNextJsHandler(handler);
