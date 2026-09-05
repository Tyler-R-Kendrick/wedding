import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Better Auth's HTTP surface: session read, sign-out, passkey authentication ceremony.
 * OTP and claim paths are disabled here (see DISABLED_AUTH_PATHS) and run as capabilities.
 * Better Auth enforces its own CSRF/origin checks and rate limits on these routes.
 */
const handler = async (request: Request) => (await getAuth()).handler(request);

export const { GET, POST } = toNextJsHandler(handler);
