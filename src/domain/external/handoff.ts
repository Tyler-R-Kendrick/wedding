import { CapabilityError } from '@/contracts/errors';
import type { ExternalHandoff } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';

/** Guest-facing provider names for handoff labels ("Continue securely with Uber"). */
export const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  uber: 'Uber',
  'uber-vouchers': 'Uber',
  zola: 'Zola',
  theknot: 'The Knot',
  withjoy: 'Joy',
  resy: 'Resy',
  opentable: 'OpenTable',
  google: 'Google Maps',
  apple: 'Apple Maps',
  hyatt: 'Hyatt',
  chicagoathletichotel: 'the Chicago Athletic Association',
  website: 'their website',
};

const HOST_NAMES: readonly [RegExp, string][] = [
  [/(^|\.)uber\.com$/, 'Uber'],
  [/(^|\.)zola\.com$/, 'Zola'],
  [/(^|\.)theknot\.com$/, 'The Knot'],
  [/(^|\.)withjoy\.com$/, 'Joy'],
  [/(^|\.)resy\.com$/, 'Resy'],
  [/(^|\.)opentable\.com$/, 'OpenTable'],
  [/(^|\.)google\.com$/, 'Google Maps'],
  [/(^|\.)apple\.com$/, 'Apple Maps'],
  [/(^|\.)hyatt\.com$/, 'Hyatt'],
  [/(^|\.)chicagoathletichotel\.com$/, 'the Chicago Athletic Association'],
];

export function providerDisplayName(provider: string, host?: string): string {
  const known = PROVIDER_DISPLAY_NAMES[provider.toLowerCase()];
  if (known && provider !== 'mock' && provider !== 'website') return known;
  if (host) {
    const hit = HOST_NAMES.find(([re]) => re.test(host.toLowerCase()));
    if (hit) return hit[1];
  }
  return known ?? provider;
}

/** What the UI renders for an outbound link. Every field is guest-safe; `host` is what the audit stores. */
export interface GuestHandoff {
  provider: string;
  providerDisplayName: string;
  label: string;
  url: string;
  host: string;
  opensNewTab: boolean;
  disclosure: string;
}

/**
 * The only way a URL becomes a guest handoff: it must pass the redirect allowlist
 * (https, allowlisted host, no credentials) — configuration in the database is not trusted
 * either, so this runs at read time even for admin-entered links.
 */
export function toGuestHandoff(h: ExternalHandoff): Result<GuestHandoff, CapabilityError> {
  const allowed = assertAllowedRedirect(h.url);
  if (!allowed.ok) return err(allowed.error);
  const host = allowed.value.hostname.toLowerCase();
  return ok({
    provider: h.provider,
    providerDisplayName: providerDisplayName(h.provider, host),
    label: h.label,
    url: allowed.value.toString(),
    host,
    opensNewTab: h.opensNewTab,
    disclosure: h.disclosure,
  });
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
