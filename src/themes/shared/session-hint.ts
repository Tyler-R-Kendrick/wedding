/**
 * What the chrome may know about this browser's session, from `/api/session`: shared by the
 * account menu (`AccountMenu`) and the preview band (`GuestViewBand`), so a page asks once.
 */
export interface SessionHint {
  signedIn: boolean;
  admin: boolean;
  /** An administrator browsing as a specific guest profile (legacy inspect flow). */
  viewAs: { name: string; household: string; readOnly: boolean } | null;
  /** An administrator previewing a synthetic role (preferred). */
  viewRole: { role: string; label: string; readOnly: boolean } | null;
  /** A guest experience preview is active (role or profile). */
  viewing: boolean;
}

export const SIGNED_OUT: SessionHint = { signedIn: false, admin: false, viewAs: null, viewRole: null, viewing: false };

let probe: Promise<SessionHint> | null = null;

function viewAsOf(v: unknown): SessionHint['viewAs'] {
  if (!v || typeof v !== 'object') return null;
  const { name, household, readOnly } = v as Record<string, unknown>;
  return typeof name === 'string' ? { name, household: typeof household === 'string' ? household : '', readOnly: readOnly !== false } : null;
}

function viewRoleOf(v: unknown): SessionHint['viewRole'] {
  if (!v || typeof v !== 'object') return null;
  const { role, label, readOnly } = v as Record<string, unknown>;
  return typeof role === 'string' && typeof label === 'string' ? { role, label, readOnly: readOnly !== false } : null;
}

/**
 * One request per page, whichever instance asks first. Only an answer is kept: a failed request
 * reads as signed out for now and is forgotten, so the next instance (or the next page) asks again
 * rather than showing "Sign in" to a signed-in guest for the rest of the visit.
 */
export function sessionProbe(fresh = false): Promise<SessionHint> {
  if (fresh) probe = null;
  if (probe) return probe;
  const asked: Promise<SessionHint> = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok) throw new Error(`session probe: ${r.status}`);
      const body = (await r.json()) as { signedIn?: unknown; admin?: unknown; viewAs?: unknown; viewRole?: unknown };
      const signedIn = body.signedIn === true;
      const viewAs = signedIn ? viewAsOf(body.viewAs) : null;
      const viewRole = signedIn ? viewRoleOf(body.viewRole) : null;
      return {
        signedIn,
        admin: signedIn && body.admin === true,
        viewAs,
        viewRole,
        viewing: viewAs !== null || viewRole !== null,
      };
    })
    .catch(() => {
      if (probe === asked) probe = null;
      return SIGNED_OUT;
    });
  probe = asked;
  return asked;
}
