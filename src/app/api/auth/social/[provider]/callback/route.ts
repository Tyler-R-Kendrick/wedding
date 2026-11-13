import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/db/client';
import { getAuditSink } from '@/lib/audit';
import { applyCookieSink, type CookieSink } from '@/lib/auth/cookies';
import { completeSocialSignIn, GUEST_SIGN_IN_FAIL_PATH, hashSocialAttemptIp } from '@/domain/identity/social/complete';
import { exchangeCode, fetchProviderProfile } from '@/domain/identity/social/oauth';
import { isSocialProvider, socialProviderConfig } from '@/domain/identity/social/providers';
import { decodeOAuthState, oauthStateCookieOptions } from '@/domain/identity/social/state';
import { siteOrigin } from '@/lib/auth';
import { env } from '@/lib/env';
import { relayTargetFor, requestHost, siteOriginOf } from '@/lib/site-hosts';
import { getClientIp, getRequestId } from '@/lib/request';
import { getProvider } from '@/providers/registry';
import { hashOtpIdentifier } from '@/domain/identity/otp';

const CALLBACK_FLOOR_MS = 150;

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const started = performance.now();
  const { provider: raw } = await ctx.params;
  // Where this request was made: the session cookie is set for this host, so the guest stays on it.
  const here = siteOriginOf(req.headers, siteOrigin(), req.nextUrl.origin);
  const guestFail = () => new URL(GUEST_SIGN_IN_FAIL_PATH, here);

  if (!isSocialProvider(raw) || !socialProviderConfig(raw)) {
    await floor(started);
    return NextResponse.redirect(guestFail());
  }

  // A sign-in that began on an alias host comes back here, because the provider knows one redirect
  // address. This host has no state cookie for it; the alias does. Pass the answer on unchanged and
  // let that host finish: it verifies `state` against its own cookie and holds the PKCE verifier,
  // so forwarding trusts nothing. Only ever to one of our own hosts (`relayTargetFor`).
  const relay = relayTargetFor(req.nextUrl.searchParams.get('state'), requestHost(req.headers), siteOrigin());
  if (relay) {
    return NextResponse.redirect(`${relay}/api/auth/social/${raw}/callback${req.nextUrl.search}`);
  }

  const jar = await cookies();
  const opts = oauthStateCookieOptions(env.isProduction);
  const stored = decodeOAuthState(jar.get(opts.name)?.value);
  jar.delete(opts.name);

  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError || !code || !state || !stored || stored.provider !== raw || stored.state !== state) {
    await floor(started);
    return NextResponse.redirect(guestFail());
  }

  const db = await getDb();
  const ip = getClientIp(req.headers, env.TRUSTED_PROXY_HOPS);
  const ipHash = hashSocialAttemptIp(ip);
  const limiter = getProvider('rate-limit', { db });
  const limited = await limiter.consume(`social:callback:ip:${hashOtpIdentifier(ip)}`, { capacity: 30, refillPerSecond: 30 / 600, failMode: 'closed' });
  if (!limited.allowed) {
    await floor(started);
    return NextResponse.redirect(guestFail());
  }

  const tokens = await exchangeCode(raw, code, stored.codeVerifier);
  if (!tokens) {
    await floor(started);
    return NextResponse.redirect(guestFail());
  }
  const profile = await fetchProviderProfile(raw, tokens.accessToken);
  if (!profile) {
    await floor(started);
    return NextResponse.redirect(guestFail());
  }

  const sink: CookieSink = { setCookies: [] };
  const audit = await getAuditSink();
  const result = await completeSocialSignIn(db, sink, {
    provider: raw,
    profile,
    accessToken: tokens.accessToken,
    next: stored.next,
    ipHash,
    requestId: getRequestId(req.headers),
    audit,
  });

  const target = new URL(result.redirectTo, here);
  const res = NextResponse.redirect(target);
  applyCookieSink(sink, res.headers);
  await floor(started);
  return res;
}

async function floor(startedMs: number): Promise<void> {
  const remaining = CALLBACK_FLOOR_MS - (performance.now() - startedMs);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
}
