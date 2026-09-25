import { startAuthorization } from '@vercel/connect';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { bearerToken } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** Temporary operator-only bridge for authorizing Resend from each deployed Vercel environment. */
export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!env.CONNECT_SETUP_TOKEN) return new Response(null, { status: 404 });
  if (!token || !timingSafeEqualString(token, env.CONNECT_SETUP_TOKEN)) return new Response(null, { status: 403 });
  if (!env.RESEND_CONNECT_USER_ID) return Response.json({ error: 'Resend subject is not configured' }, { status: 503 });

  try {
    const authorization = await startAuthorization(
      'resend/wedding',
      { subject: { type: 'user', id: env.RESEND_CONNECT_USER_ID } },
      { callbackUrl: 'https://kendrick.wedding/' },
    );
    return Response.json({ url: authorization.url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Resend Connect authorization failed', error instanceof Error ? error.name : 'unknown error');
    return Response.json({ error: 'Authorization could not start' }, { status: 503 });
  }
}
