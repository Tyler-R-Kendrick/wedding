import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/db/client';
import { parseSocialNext } from '@/domain/identity/social/complete';
import { buildAuthorizationUrl } from '@/domain/identity/social/oauth';
import { isSocialProvider, socialProviderConfig } from '@/domain/identity/social/providers';
import { encodeOAuthState, newOAuthStateToken, newPkcePair, oauthStateCookieOptions } from '@/domain/identity/social/state';
import { siteOrigin } from '@/lib/auth';
import { env } from '@/lib/env';
import { requestHost, siteOriginOf, stateForHost } from '@/lib/site-hosts';
import { getClientIp } from '@/lib/request';
import { getProvider } from '@/providers/registry';
import { hashOtpIdentifier } from '@/domain/identity/otp';

const START_FLOOR_MS = 150;

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const started = performance.now();
  const { provider: raw } = await ctx.params;
  // Redirects back into the site stay on the host the guest is using (canonical or an alias).
  const here = siteOriginOf(req.headers, siteOrigin(), req.nextUrl.origin);
  if (!isSocialProvider(raw) || !socialProviderConfig(raw)) {
    await floor(started);
    return NextResponse.redirect(new URL('/sign-in', here));
  }
  const next = parseSocialNext(req.nextUrl.searchParams.get('next'));
  const ip = getClientIp(req.headers, env.TRUSTED_PROXY_HOPS);
  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ipHash = hashOtpIdentifier(ip);
  const limited = await limiter.consume(`social:start:ip:${ipHash}`, { capacity: 30, refillPerSecond: 30 / 600, failMode: 'closed' });
  if (!limited.allowed) {
    await floor(started);
    return NextResponse.redirect(new URL('/sign-in?error=rate_limited', here));
  }

  const { verifier, challenge } = newPkcePair();
  // The provider answers on the canonical host, the only redirect address registered with it. A
  // sign-in started on an alias (fitzgerald.…) names that alias in `state`, so the canonical
  // callback can hand the answer back to the host whose browser holds this cookie.
  const state = stateForHost(newOAuthStateToken(), requestHost(req.headers), siteOrigin());
  const encoded = encodeOAuthState({ provider: raw, codeVerifier: verifier, state, next });
  const url = buildAuthorizationUrl(raw, { state, codeChallenge: challenge, next });
  if (!url) {
    await floor(started);
    return NextResponse.redirect(new URL('/sign-in', here));
  }

  const opts = oauthStateCookieOptions(env.isProduction);
  const res = NextResponse.redirect(url);
  res.cookies.set(opts.name, encoded, { httpOnly: opts.httpOnly, sameSite: opts.sameSite, path: opts.path, secure: opts.secure, maxAge: opts.maxAge });
  await floor(started);
  return res;
}

async function floor(startedMs: number): Promise<void> {
  const remaining = START_FLOOR_MS - (performance.now() - startedMs);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}
