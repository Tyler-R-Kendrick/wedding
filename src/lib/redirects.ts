import { CapabilityError } from '@/contracts/errors';
import { err, ok, type Result } from '@/contracts/result';

/**
 * External redirect allowlist. Every external handoff (Uber, Hyatt, The Knot, …)
 * must pass through `assertAllowedRedirect` before a URL is returned to a guest.
 * Hosts match exactly or as a subdomain; entries with a path require that path prefix.
 */
export interface AllowedHost {
  host: string | RegExp;
  /** Required path prefix (compare with a trailing slash so `/maps` never matches `/mapsomething`). */
  pathPrefix?: string;
  /** Match this hostname only, no subdomains (for pinned partner hosts like www.google.com). */
  exact?: boolean;
}

export const ALLOWED_REDIRECT_HOSTS: readonly AllowedHost[] = [
  { host: 'hyatt.com' },
  { host: 'chicagoathletichotel.com' },
  { host: 'uber.com' },
  { host: 'theknot.com' },
  { host: 'zola.com' },
  { host: 'withjoy.com' },
  // Maps only, on the pinned hosts: never google.com/search, docs.google.com, or apple.com/iphone.
  { host: 'www.google.com', pathPrefix: '/maps/', exact: true },
  { host: 'maps.google.com', exact: true },
  { host: 'www.apple.com', pathPrefix: '/maps/', exact: true },
  { host: 'maps.apple.com', exact: true },
  { host: 'opentable.com' },
  { host: 'resy.com' },
  // skyscanner.* — country TLDs (skyscanner.com, .net, .co.uk, .de, .com.au, …)
  { host: /^(?:[a-z0-9-]+\.)*skyscanner\.(?:[a-z]{2,3}|[a-z]{2,3}\.[a-z]{2})$/ },
  { host: 'duffel.com' },
  { host: 'booking.com' },
];

function hostMatches(hostname: string, entry: AllowedHost): boolean {
  if (entry.host instanceof RegExp) return entry.host.test(hostname);
  if (entry.exact) return hostname === entry.host;
  return hostname === entry.host || hostname.endsWith(`.${entry.host}`);
}

export function isAllowedRedirect(url: string | URL): boolean {
  return assertAllowedRedirect(url).ok;
}

/** Returns the parsed URL when allowed, otherwise a guest-safe `forbidden` error. */
export function assertAllowedRedirect(url: string | URL): Result<URL, CapabilityError> {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return err(new CapabilityError('validation', 'That link is not a valid web address.'));
  }
  if (parsed.protocol !== 'https:') {
    return err(new CapabilityError('forbidden', 'Only secure (https) links can be opened from this site.'));
  }
  if (parsed.username || parsed.password) {
    return err(new CapabilityError('forbidden', 'This link cannot be opened from this site.'));
  }
  const hostname = parsed.hostname.toLowerCase();
  for (const entry of ALLOWED_REDIRECT_HOSTS) {
    if (!hostMatches(hostname, entry)) continue;
    if (entry.pathPrefix && !parsed.pathname.startsWith(entry.pathPrefix)) continue;
    return ok(parsed);
  }
  return err(new CapabilityError('forbidden', 'This link is not on our list of trusted partners.', { host: hostname }));
}
