import { isInternalRoute } from '@/capabilities/routes';

/**
 * Where an auth journey may send someone afterwards (`next`, `back`). Only same-site paths:
 * the public allowlist from navigate_to plus the auth and admin trees. Anything else — absolute
 * URLs, protocol-relative, traversal, control characters — is refused (review S7/N4).
 */
const AUTH_ROUTES = ['/sign-in', '/sign-in/admin', '/step-up', '/claim/verify', '/claim/welcome', '/claim/passkey', '/sign-out', '/admin'] as const;
const AUTH_PREFIXES = ['/invite/', '/i/', '/claim/', '/admin/'] as const;
const SAFE_TAIL = /^[A-Za-z0-9_\-/]*$/;
const SAFE_QUERY = /^[A-Za-z0-9_\-=&%.]*$/;

export function isSafeReturnPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) return false;
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
  if (/[\s\\]/.test(path) || path.includes('..') || path.includes('://')) return false;
  const [pathname, query = '', ...rest] = path.split('?');
  if (rest.length > 0 || !SAFE_QUERY.test(query) || pathname!.includes('#')) return false;
  const clean = pathname!.replace(/\/+$/, '') || '/';
  if (isInternalRoute(clean) || (AUTH_ROUTES as readonly string[]).includes(clean)) return true;
  return AUTH_PREFIXES.some((prefix) => clean.startsWith(prefix) && SAFE_TAIL.test(clean.slice(prefix.length)));
}

export const safeReturnPath = (path: unknown, fallback: string): string => (isSafeReturnPath(path) ? path : fallback);
