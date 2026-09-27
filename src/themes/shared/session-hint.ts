/**
 * What the chrome may know about this browser's session, from `/api/session`: shared by the
 * account menu (`AccountMenu`) and the "Browse as a guest" band (`GuestViewBand`), so a page asks once.
 */
export interface SessionHint {
  signedIn: boolean;
  admin: boolean;
  /** An administrator browsing as a guest: whose view, for the band that says so. */
  viewAs: { name: string; household: string; readOnly: boolean } | null;
  /** `viewAs` is set; also known server-side on pages that resolved the principal. */
  viewing: boolean;
}

export const SIGNED_OUT: SessionHint = { signedIn: false, admin: false, viewAs: null, viewing: false };

let probe: Promise<SessionHint> | null = null;

function viewAsOf(v: unknown): SessionHint['viewAs'] {
  if (!v || typeof v !== 'object') return null;
  const { name, household, readOnly } = v as Record<string, unknown>;
  return typeof name === 'string' ? { name, household: typeof household === 'string' ? household : '', readOnly: readOnly !== false } : null;
}

/**
 * One request per page, whichever instance asks first. Only an answer is kept: a failed request
 * reads as signed out for now and is forgotten, so the next instance (or the next page) asks again
 * rather than showing "Sign in" to a signed-in guest for the rest of the visit.
 */
export function sessionProbe(fresh = false): Promise<SessionHint> {
  if (fresh) probe = null;
  if (probe) return probe;
  // The cached promise is the one that already handles failure: every caller shares it, so a raw
  // fetch promise here would hand each of them a rejection nobody catches.
  const asked: Promise<SessionHint> = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok) throw new Error(`session probe: ${r.status}`);
      const body = (await r.json()) as { signedIn?: unknown; admin?: unknown; viewAs?: unknown };
      const signedIn = body.signedIn === true;
      const viewAs = signedIn ? viewAsOf(body.viewAs) : null;
      return { signedIn, admin: signedIn && body.admin === true, viewAs, viewing: viewAs !== null };
    })
    .catch(() => {
      if (probe === asked) probe = null;
      return SIGNED_OUT;
    });
  probe = asked;
  return asked;
}
