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
  /**
   * Whether this reader is one of the couple and may use the problem reporter
   * (src/components/feedback). Only meaningful when `resolved`: a failed request reads false here,
   * and the reporter treats "no answer" as "no change".
   */
  reporter: boolean;
}

export const SIGNED_OUT: SessionHint = { resolved: false, signedIn: false, distinctId: null, admin: false, viewAs: null, viewRole: null, viewing: false, portals: [], reporter: false };

let probe: Promise<SessionHint> | null = null;
/** The address `probe` was asked on. A remembered answer is good for that address only. */
let probedOn: string | null = null;

const here = (): string => (typeof location === 'undefined' ? '' : location.pathname);

const hintListeners = new Set<(hint: SessionHint) => void>();

/** Hears every answer `/api/session` gives on this page, whoever asked. Returns the unsubscribe. */
export function onSessionHint(listener: (hint: SessionHint) => void): () => void {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

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

/** Asks `/api/session` once and reads the answer. Rejects when there is none to read. */
async function ask(): Promise<SessionHint> {
  const r = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`session probe: ${r.status}`);
  const body = (await r.json()) as { signedIn?: unknown; distinctId?: unknown; admin?: unknown; viewAs?: unknown; viewRole?: unknown; portals?: unknown; reporter?: unknown };
  const signedIn = body.signedIn === true;
  const distinctId = signedIn && typeof body.distinctId === 'string' && body.distinctId.length > 0 ? body.distinctId : null;
  const viewAs = signedIn ? viewAsOf(body.viewAs) : null;
  const viewRole = signedIn ? viewRoleOf(body.viewRole) : null;
  const portals = signedIn ? portalsOf(body.portals) : [];
  const hint: SessionHint = {
    resolved: true,
    signedIn,
    distinctId,
    admin: signedIn && body.admin === true,
    viewAs,
    viewRole,
    viewing: viewAs !== null || viewRole !== null,
    portals,
    reporter: signedIn && body.reporter === true,
  };
  for (const listener of hintListeners) listener(hint);
  return hint;
}

/**
 * One request per page, whichever instance asks first. Only an answer is kept: a failed request
 * reads as signed out for now and is forgotten, so the next instance (or the next page) asks again
 * rather than showing "Sign in" to a signed-in guest for the rest of the visit.
 *
 * "Per page" means per address, not per document. The router moves between pages without
 * reloading, and the session can change on the way: "Browse as a guest" is a server action on an
 * admin page that lands on a guest page. An answer remembered across that move says nobody is being
 * browsed as, and the band that says whose view it is never appears. That was invisible while
 * nothing on an admin page asked; once something in the root layout asks on every page
 * (`PostHogIdentity`), every such move starts from a stale answer. So the answer is kept for the
 * address it was asked on, and the first instance on a new address asks again.
 */
export function sessionProbe(fresh = false): Promise<SessionHint> {
  if (fresh || probedOn !== here()) probe = null;
  if (probe) return probe;
  probedOn = here();
  const asked: Promise<SessionHint> = ask().catch(() => {
    if (probe === asked) probe = null;
    return SIGNED_OUT;
  });
  probe = asked;
  return asked;
}

/** Whether something on this page has already asked (and so `onSessionHint` will hear the answer). */
export const sessionAsked = (): boolean => probe !== null && probedOn === here();

/**
 * Asks without becoming the page's remembered answer: for a caller with no stake in the chrome
 * (the problem reporter, when nothing else on the page has asked). Listeners still hear it.
 */
export function askSession(): Promise<SessionHint> {
  return ask().catch(() => SIGNED_OUT);
}
