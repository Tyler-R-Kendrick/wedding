import { getPrincipal } from '@/lib/principal';
import { mintStageToken, STAGE_DOOR_PATH, STAGE_ENTER_PATH, stageAccess, stageReturn } from '@/lib/stage-access';

export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
const redirect = (location: string) => new Response(null, { status: 307, headers: { Location: location, 'Cache-Control': 'no-store' } });

/**
 * The door to the design stages (src/lib/stage-access.ts). A stage address with no pass sends the
 * browser here; an admin is sent back with a one-minute ticket, anyone signed out goes to the admin
 * sign-in and returns here, and everybody else gets the same 404 a made-up address would.
 *
 * The return address is built here from `via` and `to`, never taken from the request, so this
 * cannot be used to send an admin's ticket to another site.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') ?? url.host;
  const secret = process.env.BETTER_AUTH_SECRET;
  const back = stageReturn(url.searchParams.get('via'), url.searchParams.get('to'), host);
  if (stageAccess({ VERCEL: process.env.VERCEL, BETTER_AUTH_SECRET: secret }) !== 'admin' || !secret || !back) return notFound();
  if (back.origin === host && process.env.VERCEL_ENV === 'production') return notFound();

  const principal = await getPrincipal(request);
  if (principal.kind === 'anonymous') return redirect(`/sign-in/admin?next=${encodeURIComponent(`${STAGE_DOOR_PATH}${url.search}`)}`);
  // An admin looking at the site as a guest is still an admin.
  if (principal.kind !== 'admin' && !(principal.kind === 'guest' && principal.viewedBy)) return notFound();

  const protocol = (request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')) === 'http' ? 'http' : 'https';
  const ticket = mintStageToken(secret, 'ticket', back.scope);
  return redirect(`${protocol}://${back.origin}${STAGE_ENTER_PATH}?t=${ticket}&to=${encodeURIComponent(back.path)}`);
}
