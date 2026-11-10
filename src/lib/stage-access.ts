/**
 * Who may see the design pipeline's stages when the app serves them (src/lib/stage-hosting.ts).
 *
 * The stages redraw the real pages, the guest and admin ones included, with their headings and
 * labels left readable. That is the venue's name on the venue page and the date on the dashboard,
 * on an address that takes no sign-in: `wireframe.dev.<domain>` in production, `/wireframe/…` on a
 * preview deployment whose address the pull request prints. Nothing about the wedding is public, so
 * a deployed stage is closed unless a password is set, and asks for it when one is.
 *
 *   on Vercel, no STAGES_PASSWORD   closed: every stage address is a 404
 *   on Vercel, STAGES_PASSWORD set  the browser's own password prompt (HTTP Basic, any user name)
 *   anywhere else                   open: a local checkout and CI serve them as before
 *
 * A stage is a static export on a host that has no sign-in page and shares no cookie with the
 * site, so the site's own sessions cannot guard it; the browser's prompt needs neither. Pure, so
 * the proxy and its tests read the same rule.
 */
export type StageAccess = 'open' | 'closed' | 'password';

export function stageAccess(env: { VERCEL?: string | undefined; STAGES_PASSWORD?: string | undefined }): StageAccess {
  if (!env.VERCEL) return 'open';
  return env.STAGES_PASSWORD ? 'password' : 'closed';
}

/** Equal without stopping at the first difference, so a guess learns nothing from the timing. */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** `Authorization: Basic base64(user:password)`; the user name is not checked. */
export function stageAuthorized(authorization: string | null | undefined, password: string): boolean {
  if (!password || !authorization) return false;
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(authorization.trim());
  if (!match) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1]!), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const colon = decoded.indexOf(':');
  return colon >= 0 && sameString(decoded.slice(colon + 1), password);
}

/** The answer for a stage request, or null to serve it. */
export function stageDenial(access: StageAccess, authorization: string | null | undefined, password: string | undefined): { status: 401 | 404; headers: Record<string, string>; body: string } | null {
  if (access === 'open') return null;
  if (access === 'closed') return { status: 404, headers: { 'Cache-Control': 'no-store' }, body: 'Not found' };
  if (stageAuthorized(authorization, password ?? '')) return null;
  return { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Design stages", charset="UTF-8"', 'Cache-Control': 'no-store' }, body: 'The design stages need their password.' };
}
