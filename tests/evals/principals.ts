import type { AdminPrincipal, Entitlement, GuestPrincipal, Principal } from '@/contracts/principal';

/**
 * Who asks the concierge during an eval.
 *
 * These are the REAL guests `ensureSwarmESeeded` writes (`SEED_TEST_FIXTURES=1`), not invented ids:
 * since level 09 the seating and RSVP tables carry real foreign keys to `guests`, so a synthetic
 * principal cannot be assigned a seat or file an RSVP, and any case that pretended to would be
 * exercising a fixture rather than the shipped code. Household A holds Ada, Ben and Cleo; household
 * B holds Dev and Eve; household C holds Fin.
 */
export const EVAL_GUESTS = {
  'guest-a': { guestId: '01E2EGSTA10000000000000000', householdId: '01E2EHHA000000000000000000', firstName: 'Ada' },
  'guest-b': { guestId: '01E2EGSTB10000000000000000', householdId: '01E2EHHB000000000000000000', firstName: 'Dev' },
  'guest-plain': { guestId: '01E2EGSTC10000000000000000', householdId: '01E2EHHC000000000000000000', firstName: 'Fin' },
} as const;

/** The published chart the evals read through `get_my_table`. Named, not numbered, as the seeds are. */
export const EVAL_TABLES = {
  A: { id: '01E2ETBLA00000000000000000', name: 'Table 3', sortOrder: 3 },
  B: { id: '01E2ETBLB00000000000000000', name: 'Table 12', sortOrder: 12 },
} as const;

export type EvalPrincipalName = 'anonymous' | 'guest-a' | 'guest-b' | 'guest-plain' | 'admin';

const GUEST_BASE: Entitlement[] = ['view_event', 'rsvp_self', 'view_private_schedule', 'view_travel_tools', 'use_concierge'];

const guest = (key: keyof typeof EVAL_GUESTS, entitlements: Entitlement[]): GuestPrincipal => {
  const g = EVAL_GUESTS[key];
  return {
    kind: 'guest',
    authIdentityId: `auth-${g.guestId}` as never,
    guestId: g.guestId as never,
    householdId: g.householdId as never,
    actsFor: [g.guestId as never],
    entitlements: new Set(entitlements),
    authenticatedAt: new Date().toISOString(),
    sessionId: `eval-${key}`,
  };
};

const admin: AdminPrincipal = {
  kind: 'admin',
  authIdentityId: 'auth-ADM' as never,
  adminId: 'ADM_1' as never,
  roles: new Set(['owner']),
  entitlements: new Set(['admin_ai', 'admin_content', 'admin_audit']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'eval-admin',
};

export const EVAL_PRINCIPALS: Record<EvalPrincipalName, Principal> = {
  anonymous: { kind: 'anonymous' },
  'guest-a': guest('guest-a', [...GUEST_BASE, 'view_table_assignment', 'manage_household_rsvp']),
  'guest-b': guest('guest-b', [...GUEST_BASE, 'view_table_assignment']),
  'guest-plain': guest('guest-plain', GUEST_BASE),
  admin,
};
