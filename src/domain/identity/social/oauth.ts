import type { SocialProvider } from '@/db/schema/social-auth';
import { socialProviderConfig, socialRedirectUri } from './providers';

export interface OAuthProfile {
  providerAccountId: string;
  givenName?: string | null;
  familyName?: string | null;
  name?: string | null;
  /** Provider email when returned; used for administrator matching only. */
  email?: string | null;
  /** Google `email_verified`; Facebook omits unconfirmed addresses — treat missing email as unverified. */
  emailVerified?: boolean;
}

export function buildAuthorizationUrl(provider: SocialProvider, input: { state: string; codeChallenge: string; next: string | null }): string | null {
  const cfg = socialProviderConfig(provider);
  if (!cfg) return null;
  const redirect = socialRedirectUri(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state: input.state,
  });
  if (cfg.usePkce) {
    params.set('code_challenge', input.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (provider === 'google') params.set('access_type', 'online');
  return `${cfg.authorizationUrl}?${params.toString()}`;
}

export async function exchangeCode(provider: SocialProvider, code: string, codeVerifier: string): Promise<{ accessToken: string } | null> {
  const cfg = socialProviderConfig(provider);
  if (!cfg) return null;
  const redirect = socialRedirectUri(provider);
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
    code,
  });
  if (cfg.usePkce) body.set('code_verifier', codeVerifier);
  const res = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) return null;
  return { accessToken: json.access_token };
}

export async function fetchProviderProfile(provider: SocialProvider, accessToken: string): Promise<OAuthProfile | null> {
  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      sub?: string;
      given_name?: string;
      family_name?: string;
      name?: string;
      email?: string;
      email_verified?: boolean;
    };
    if (!json.sub) return null;
    return {
      providerAccountId: json.sub,
      givenName: json.given_name ?? null,
      familyName: json.family_name ?? null,
      name: json.name ?? null,
      email: json.email ?? null,
      emailVerified: json.email_verified === true,
    };
  }
  if (provider === 'facebook') {
    const url = new URL('https://graph.facebook.com/v21.0/me');
    url.searchParams.set('fields', 'id,name,first_name,last_name,email');
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { id?: string; first_name?: string; last_name?: string; name?: string; email?: string };
    if (!json.id) return null;
    const email = json.email?.trim() || null;
    return {
      providerAccountId: json.id,
      givenName: json.first_name ?? null,
      familyName: json.last_name ?? null,
      name: json.name ?? null,
      email,
      emailVerified: email != null,
    };
  }
  return null;
}
