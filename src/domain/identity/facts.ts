import type { Db } from '@/db/client';
import type { GuestRow, HouseholdRow, InvitationRow } from '@/db/schema';
import type { EntitlementFacts } from '@/policy/derive';

/**
 * Seam for facts owned by other swarms. Swarm E registers seating publication and event
 * entitlements; Swarm G registers transportation eligibility. Until they do, the defaults
 * below apply: events come from the invitation, seating is unpublished, transport eligibility
 * follows the guest kind. Sources may only *narrow or extend facts*, never authorization.
 */
export type EntitlementFactSource = (db: Db, ctx: { guest: GuestRow; household: HouseholdRow; invitation: InvitationRow | null }) => Promise<Partial<EntitlementFacts>>;

const g = globalThis as unknown as { __weddingFactSources?: Map<string, EntitlementFactSource> };
const sources = (): Map<string, EntitlementFactSource> => (g.__weddingFactSources ??= new Map());

export function registerEntitlementFactSource(name: string, source: EntitlementFactSource): void {
  sources().set(name, source);
}

export function unregisterEntitlementFactSource(name: string): void {
  sources().delete(name);
}

export function defaultEntitlementFacts(ctx: { guest: GuestRow; invitation: InvitationRow | null }): EntitlementFacts {
  return {
    invitedEventKeys: ctx.invitation?.eventKeys ?? [],
    seatingPublished: false,
    transportEligible: ctx.guest.kind !== 'child' && !ctx.guest.isMinor,
  };
}

export async function collectEntitlementFacts(db: Db, ctx: { guest: GuestRow; household: HouseholdRow; invitation: InvitationRow | null }): Promise<EntitlementFacts> {
  let facts = defaultEntitlementFacts(ctx);
  for (const source of sources().values()) {
    try {
      facts = { ...facts, ...(await source(db, ctx)) };
    } catch {
      // A failing fact source must never widen access: keep the conservative defaults.
    }
  }
  return facts;
}
