/**
 * The site answers on more than one hostname, and every one of them is the wedding site.
 *
 * `kendrick.wedding` is the canonical origin (`BETTER_AUTH_URL`); `fitzgerald.kendrick.wedding` was
 * added beside it so both families have an address with their own name on it. Before this module the
 * auth code knew one origin only, so on the second host Google and Facebook sign-in came back to a
 * browser holding no state cookie, a passkey was refused for its origin, and Better Auth's own routes
 * (sign-out, the passkey ceremony) answered 403 to a perfectly same-origin request.
 *
 * An alias is always `<label>.<canonical host>`: a subdomain of the canonical host, so it is under
 * the same DNS control and can never name somebody else's site. That also makes the rule work
 * unchanged on a preview (`fitzgerald.<preview host>` simply never resolves) and locally
 * (`fitzgerald.localhost:3000`). Adding a host is one label here plus the domain in Vercel.
 *
 * Sessions stay per host: a cookie set on one hostname is not sent to the other, so a guest signs in
 * on the address they use. Links in e-mail keep pointing at the canonical origin.
 *
 * Pure and dependency-free: imported by the auth config, the CSRF checks and the OAuth routes.
 */
export const SITE_ALIAS_LABELS = ['fitzgerald'] as const;

const trimOrigin = (origin: string): string => origin.replace(/\/+$/, '');

function parse(origin: string | null | undefined): URL | null {
  if (!origin) return null;
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

/** A bare IP has no subdomains to speak of. */
const isIp = (hostname: string): boolean => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');

/** `https://fitzgerald.kendrick.wedding` for a canonical `https://kendrick.wedding`. */
export function aliasOrigins(canonicalOrigin: string): string[] {
  const url = parse(canonicalOrigin);
  if (!url || isIp(url.hostname)) return [];
  return SITE_ALIAS_LABELS.map((label) => `${url.protocol}//${label}.${url.host}`);
}

/** The canonical origin first, then every alias. Each is the site, and each is trusted as such. */
export function siteOriginsFor(canonicalOrigin: string): string[] {
  return [...new Set([trimOrigin(canonicalOrigin), ...aliasOrigins(canonicalOrigin)])];
}

/** The alias label a host carries (`fitzgerald.kendrick.wedding` → `fitzgerald`), or null. */
export function aliasLabelOf(host: string | null | undefined, canonicalOrigin: string): string | null {
  const url = parse(canonicalOrigin);
  if (!host || !url) return null;
  const wanted = host.trim().toLowerCase();
  return SITE_ALIAS_LABELS.find((label) => wanted === `${label}.${url.host.toLowerCase()}`) ?? null;
}

/** The origin of a known alias label, or null for anything this module did not define. */
export function aliasOriginFor(label: string | null | undefined, canonicalOrigin: string): string | null {
  const url = parse(canonicalOrigin);
  if (!label || !url || isIp(url.hostname)) return null;
  return (SITE_ALIAS_LABELS as readonly string[]).includes(label) ? `${url.protocol}//${label}.${url.host}` : null;
}

/** The host a request was made to, as the browser named it (the platform's proxy forwards it). */
export function requestHost(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return (forwarded || headers.get('host') || '').toLowerCase() || null;
}

/**
 * The origin to build a same-site redirect on: the one the request was made to, when that is the
 * canonical host or one of its aliases, and otherwise `fallback`. A framework's own idea of the
 * request URL can name an internal host behind a proxy; a `Host` header can be anything. This
 * returns one of our own origins or the fallback, never a value taken from the request.
 */
export function siteOriginOf(headers: Headers, canonicalOrigin: string, fallback: string): string {
  const host = requestHost(headers);
  const match = host ? siteOriginsFor(canonicalOrigin).find((origin) => parse(origin)?.host.toLowerCase() === host) : undefined;
  return match ?? fallback;
}

/**
 * The OAuth `state` a sign-in started on an alias carries: `<random>.<label>`. Google and Facebook
 * each hold ONE registered redirect address, on the canonical host, so the provider always answers
 * there; the label is how that callback knows which of our own hosts holds the state cookie and
 * hands the answer on (`relayTargetFor`). Base64url has no dot, so the separator is unambiguous.
 */
export function stateForHost(state: string, host: string | null | undefined, canonicalOrigin: string): string {
  const label = aliasLabelOf(host, canonicalOrigin);
  return label ? `${state}.${label}` : state;
}

/**
 * Where a provider's answer belongs, when that is not the host it arrived on: the alias named in
 * `state`, and only when it is one of ours. Null means "handle it here".
 *
 * Nothing is trusted by forwarding: the alias still has to hold the signed state cookie and the PKCE
 * verifier the code is useless without, exactly as the canonical host would.
 */
export function relayTargetFor(state: string | null | undefined, host: string | null | undefined, canonicalOrigin: string): string | null {
  const label = state?.includes('.') ? state.slice(state.lastIndexOf('.') + 1) : null;
  const target = aliasOriginFor(label, canonicalOrigin);
  if (!target) return null;
  return aliasLabelOf(host, canonicalOrigin) === label ? null : target;
}
