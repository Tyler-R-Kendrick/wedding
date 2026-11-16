import type { Principal } from '@/contracts/principal';
import { REPORTER_PASS_COOKIE } from './constants';
import { mintReporterPass, readReporterPass, reporterPassCookie, reporterPassSecret } from './pass';

/**
 * Who may file a problem report: an owner, which is to say Tyler or Sara (`ADMIN_EMAILS`). Not the
 * planner, not a moderator, not a guest.
 */
export interface Reporter {
  adminId: string;
  /** `pass`: recognised by this device's signed cookie alone. `session`: by a live sign-in. */
  via: 'session' | 'pass';
}

/** The owner behind a principal, including an owner who is browsing the site as a guest. */
export function ownerAdminId(principal: Principal): string | null {
  if (principal.kind === 'admin') return principal.roles.has('owner') ? principal.adminId : null;
  if (principal.kind === 'guest' && principal.viewedBy) return principal.viewedBy.roles.has('owner') ? principal.viewedBy.adminId : null;
  return null;
}

export function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwarded) return forwarded === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The `Set-Cookie` that gives (or renews) an owner's pass, or null when there is no secret to sign with. */
export function reporterPassHeader(request: Request, adminId: string): string | null {
  const secret = reporterPassSecret();
  const token = secret ? mintReporterPass(secret, adminId) : null;
  return token ? reporterPassCookie(REPORTER_PASS_COOKIE, token, { secure: isSecureRequest(request) }) : null;
}

export const clearReporterPassHeader = (request: Request): string => reporterPassCookie(REPORTER_PASS_COOKIE, null, { secure: isSecureRequest(request) });

/** How long the endpoint waits on sign-in before deciding it is not going to answer. */
const SESSION_WAIT_MS = 2_500;

async function liveOwner(request: Request): Promise<string | null> {
  if (!request.headers.get('cookie') && !request.headers.get('x-test-principal')) return null;
  try {
    // Loaded here, not at the top: if sign-in's own modules will not load, the pass still works.
    const { getPrincipal } = await import('@/lib/principal');
    const principal = await Promise.race([getPrincipal(request), new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_WAIT_MS).unref?.())]);
    return principal ? ownerAdminId(principal) : null;
  } catch {
    return null;
  }
}

/**
 * The reporter behind a request, or null. The pass is read first: it needs no database, so a report
 * about a broken sign-in is recognised as quickly as any other. Without one, a live owner session
 * counts, and earns the pass (`setCookie`) for next time.
 */
export async function resolveReporter(request: Request): Promise<{ reporter: Reporter | null; setCookie?: string }> {
  const pass = readReporterPass(reporterPassSecret(), cookieValue(request, REPORTER_PASS_COOKIE));
  if (pass) return { reporter: { adminId: pass.adminId, via: 'pass' } };
  const adminId = await liveOwner(request);
  if (!adminId) return { reporter: null };
  const setCookie = reporterPassHeader(request, adminId);
  return { reporter: { adminId, via: 'session' }, ...(setCookie ? { setCookie } : {}) };
}
