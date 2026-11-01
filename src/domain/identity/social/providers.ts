import 'server-only';
import { env } from '@/lib/env';
import { siteOrigin } from '@/lib/auth';
import type { SocialProvider } from '@/db/schema/social-auth';

export interface SocialProviderConfig {
  id: SocialProvider;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  usePkce: boolean;
}

export function socialRedirectUri(provider: SocialProvider): string {
  return `${siteOrigin()}/api/auth/social/${provider}/callback`;
}

export function configuredSocialProviders(): SocialProvider[] {
  const out: SocialProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push('google');
  if (env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET) out.push('facebook');
  return out;
}

export function socialProviderConfig(id: SocialProvider): SocialProviderConfig | null {
  if (id === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
    return {
      id,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'profile'],
      usePkce: true,
    };
  }
  if (id === 'facebook') {
    if (!env.FACEBOOK_CLIENT_ID || !env.FACEBOOK_CLIENT_SECRET) return null;
    return {
      id,
      clientId: env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
      authorizationUrl: 'https://www.facebook.com/v21.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v21.0/oauth/access_token',
      scopes: ['public_profile'],
      usePkce: true,
    };
  }
  return null;
}

export function isSocialProvider(value: string): value is SocialProvider {
  return value === 'google' || value === 'facebook';
}
