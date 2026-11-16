/**
 * What the chrome may know about this browser's session, from `/api/session`: shared by the
 * account menu (`AccountMenu`) and the preview band (`GuestViewBand`), so a page asks once.
 */
export interface SessionHint {
  /** Whether the session endpoint answered successfully (rather than falling back after a failed request). */
  resolved: boolean;
  signedIn: boolean;
  /** Opaque, immutable authenticated account id for analytics; never a guest name or email. */
  distinctId: string | null;
  admin: boolean;
  /** An administrator browsing as a specific guest profile (legacy inspect flow). */
  viewAs: { name: string; household: string; readOnly: boolean } | null;
  /** An administrator previewing a synthetic role (preferred). */
  viewRole: { role: string; label: string; readOnly: boolean } | null;
  /** A guest experience preview is active (role or profile). */
  viewing: boolean;
  /** Guest Portal / Admin Portal links for the account menu. */
  portals: { label: string; href: string }[];
}

export const SIGNED_OUT: SessionHint = { resolved: false, signedIn: false, distinctId: null, admin: false, viewAs: null, viewRole: null, viewing: false, portals: [] };

/** The answer for one page. Keyed by its path: a tab outlives a page, and who is reading can change between two of them. */
let probe: { path: string; asked: Promise<SessionHint> } | null = null;
const currentPath = () => (typeof window === 'undefined' ? '' : window.location.pathname);

function viewAsOf(v: unknown): SessionHint['viewAs'] {
  if (!v || typeof v !== 'object') return null;
  const { name, household, readOnly } = v as Record<string, unknown>;
  return typeof name === 'string' ? { name, household: typeof household === 'string' ? household : '', readOnly: readOnly !== false } : null;
}

function portalsOf(v: unknown): SessionHint['portals'] {
  if (!Array.isArray(v)) return [];
  const out: SessionHint['portals'] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const { label, href } = row as Record<string, unknown>;
    if (typeof label === 'string' && typeof href === 'string') out.push({ label, href });
  }
  return out;
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
 *
 * "Per page" is the path, not the tab. The root layout asks on every page (PostHog's identity),
 * including the console, and a move between pages does not reload the tab: an answer kept for the
 * tab would tell the guest pages what the console page heard, so an administrator who starts
 * browsing as a guest would get no "Inspecting as" band until they reloaded.
 */
export function sessionProbe(fresh = false): Promise<SessionHint> {
  const path = currentPath();
  if (fresh || probe?.path !== path) probe = null;
  if (probe) return probe.asked;
  const asked: Promise<SessionHint> = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
    .then(async (r) => {
      if (!r.ok) throw new Error(`session probe: ${r.status}`);
      const body = (await r.json()) as { signedIn?: unknown; distinctId?: unknown; admin?: unknown; viewAs?: unknown; viewRole?: unknown; portals?: unknown };
      const signedIn = body.signedIn === true;
      const distinctId = signedIn && typeof body.distinctId === 'string' && body.distinctId.length > 0 ? body.distinctId : null;
      const viewAs = signedIn ? viewAsOf(body.viewAs) : null;
      const viewRole = signedIn ? viewRoleOf(body.viewRole) : null;
      const portals = signedIn ? portalsOf(body.portals) : [];
      return {
        resolved: true,
        signedIn,
        distinctId,
        admin: signedIn && body.admin === true,
        viewAs,
        viewRole,
        viewing: viewAs !== null || viewRole !== null,
        portals,
      };
    })
    .catch(() => {
      if (probe?.asked === asked) probe = null;
      return SIGNED_OUT;
    });
  probe = { path, asked };
  return asked;
}
