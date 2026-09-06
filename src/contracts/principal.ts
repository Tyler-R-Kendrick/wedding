import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from './ids';

/**
 * Capability-based entitlements. Authorization decisions are made server-side
 * against these; hidden UI or omitted WebMCP tools are never authorization.
 */
export const ENTITLEMENTS = [
  'view_event',
  'rsvp_self',
  'manage_household_rsvp',
  'view_private_schedule',
  'view_table_assignment',
  'claim_transportation_benefit',
  'view_travel_tools',
  'upload_media',
  'view_private_media',
  'use_face_matching',
  'use_concierge',
  'admin_content',
  'admin_guest_ops',
  'admin_media',
  'admin_ai',
  'admin_audit',
  'admin_lifecycle',
  'admin_integrations',
] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

export const ADMIN_ROLES = ['owner', 'planner', 'moderator'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AnonymousPrincipal = { kind: 'anonymous' };

export type GuestPrincipal = {
  kind: 'guest';
  authIdentityId: AuthIdentityId;
  guestId: GuestId;
  householdId: HouseholdId;
  /** Guests this principal may act for (self + household members when household manager). */
  actsFor: GuestId[];
  entitlements: ReadonlySet<Entitlement>;
  /** ISO time the session last proved possession (OTP/passkey). Used for step-up. */
  authenticatedAt: string;
  sessionId: string;
};

export type AdminPrincipal = {
  kind: 'admin';
  authIdentityId: AuthIdentityId;
  adminId: AdminId;
  roles: ReadonlySet<AdminRole>;
  entitlements: ReadonlySet<Entitlement>;
  authenticatedAt: string;
  sessionId: string;
  /** Optional: admin previewing the site as a guest. Never grants that guest's private data. */
  previewAs?: { lifecycle?: string; theme?: string };
};

/** Trusted server-side callers (jobs, webhooks) — never derived from a browser request. */
export type SystemPrincipal = { kind: 'system'; component: string };

export type Principal = AnonymousPrincipal | GuestPrincipal | AdminPrincipal | SystemPrincipal;

export const isGuest = (p: Principal): p is GuestPrincipal => p.kind === 'guest';
export const isAdmin = (p: Principal): p is AdminPrincipal => p.kind === 'admin';
export const isSystem = (p: Principal): p is SystemPrincipal => p.kind === 'system';

export function hasEntitlement(p: Principal, e: Entitlement): boolean {
  if (p.kind === 'system') return true;
  if (p.kind === 'anonymous') return false;
  return p.entitlements.has(e);
}

/** Fresh-session window for consequential actions (money, identity, external commitments). */
export const STEP_UP_MAX_AGE_SECONDS = 5 * 60;

export function isSessionFresh(p: Principal, now: Date = new Date(), maxAgeSeconds = STEP_UP_MAX_AGE_SECONDS): boolean {
  if (p.kind === 'system') return true;
  if (p.kind === 'anonymous') return false;
  const authedAt = Date.parse(p.authenticatedAt);
  if (!Number.isFinite(authedAt)) return false;
  // A timestamp in the future is not "fresh", it is forged or mis-clocked: never accept it.
  const age = now.getTime() - authedAt;
  return age >= 0 && age <= maxAgeSeconds * 1000;
}

/** Minimal, log-safe reference to a principal for audit rows. */
export type PrincipalRef =
  | { kind: 'anonymous' }
  | { kind: 'guest'; guestId: GuestId; householdId: HouseholdId }
  | { kind: 'admin'; adminId: AdminId }
  | { kind: 'system'; component: string };

export function toPrincipalRef(p: Principal): PrincipalRef {
  switch (p.kind) {
    case 'anonymous':
      return { kind: 'anonymous' };
    case 'guest':
      return { kind: 'guest', guestId: p.guestId, householdId: p.householdId };
    case 'admin':
      return { kind: 'admin', adminId: p.adminId };
    case 'system':
      return { kind: 'system', component: p.component };
  }
}
