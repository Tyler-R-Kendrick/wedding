import { beforeAll, describe, expect, it } from 'vitest';
import { invoke } from '@/capabilities/invoke';
import type { AnyCapability, CapabilityContext, CapabilityExposure } from '@/contracts/capability';
import { FEATURE_FLAGS, type FlagValues } from '@/contracts/flags';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { MemoryAuditSink } from '@/lib/audit';
import { authorize } from '@/policy/entitlements';

/**
 * Sign-in is required for anything about the wedding.
 *
 * The date, the venue, the city, the hotel block, the schedule and every Chicago recommendation are
 * the invited guests'. Each capability that reads one of them was `auth: 'anonymous'` while the site
 * had public pages for them; they are `auth: 'guest'` now, and this pins that against the REAL
 * registry on every surface (the pages, the concierge and WebMCP all go through `invoke`). A
 * capability that slips back to anonymous, or a new anonymous one, shows up here as a diff someone
 * has to justify.
 */
const WEDDING_DETAIL_CAPABILITIES = [
  'site_status', // the date and the venue's name and address
  'get_venue_facts',
  'show_venue_room',
  'list_itineraries',
  'find_adventures',
  'get_reservation_options',
  'open_reservation_link',
  'list_hotel_recommendations', // the room block
  'search_travel_options',
  'open_booking_link',
  'get_my_transportation_options',
] as const;

/** Everything a caller with no session may run: the couple's story, moving between pages, and the sign-in doors. */
const ANONYMOUS_CAPABILITIES = ['get_story', 'list_adventures', 'lookup_invitation', 'navigate_to', 'request_otp', 'request_phone_otp', 'show_adventure', 'verify_guest_sign_in_pass', 'verify_otp', 'verify_phone_otp'];
/** The ones an assistant or a browser agent is offered without a session. None of the sign-in doors. */
const ANONYMOUS_AGENT_CAPABILITIES = ['get_story', 'list_adventures', 'navigate_to', 'show_adventure'];

const SURFACES: (keyof CapabilityExposure)[] = ['ui', 'ai', 'webmcp'];
// Every flag on, so a capability behind one is refused for who is asking and not for the flag.
const flags = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((k) => [k, true])) as FlagValues;

const anonymous: Principal = { kind: 'anonymous' };
const guest: Principal = {
  kind: 'guest',
  authIdentityId: 'auth-guest' as AuthIdentityId,
  guestId: 'guest-1' as GuestId,
  householdId: 'house-1' as HouseholdId,
  actsFor: ['guest-1' as GuestId],
  entitlements: new Set(),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'session-guest',
};
const admin: Principal = {
  kind: 'admin',
  authIdentityId: 'auth-admin' as AuthIdentityId,
  adminId: 'admin-1' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'session-admin',
};

const context = (principal: Principal, surface: keyof CapabilityExposure): { ctx: CapabilityContext; audit: MemoryAuditSink } => {
  const audit = new MemoryAuditSink();
  return { ctx: { principal, requestId: `sign-in-required-${surface}`, now: new Date(), flags, audit, inputTrust: 'TRUSTED_WEDDING', surface, services: {} }, audit };
};

describe('sign-in is required for anything about the wedding', () => {
  // The registry barrel is every capability and the schema behind them; loaded once, with its own budget.
  let registry: Awaited<typeof import('@/capabilities')>['registry'];
  const capability = (name: string): AnyCapability => {
    const found = registry.list({}).find((c) => c.name === name);
    if (!found) throw new Error(`${name} is not registered`);
    return found;
  };
  beforeAll(async () => {
    ({ registry } = await import('@/capabilities'));
  }, 120_000);

  it.each(WEDDING_DETAIL_CAPABILITIES)('%s asks for a session', (name) => {
    const cap = capability(name);
    expect(cap.auth).toBe('guest');
    const refused = authorize(cap, anonymous);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('unauthenticated');
    // A signed-in guest needs nothing more than the session: no entitlement stands in the way.
    expect(cap.requires).toEqual([]);
    expect(authorize(cap, guest).ok).toBe(true);
  });

  it.each(WEDDING_DETAIL_CAPABILITIES)('%s refuses an anonymous caller on every surface, before reading its input or running', async (name) => {
    const cap = capability(name);
    for (const surface of SURFACES) {
      if (!cap.exposure[surface]) continue;
      // No services and no database behind this context: a call that got past authorization would
      // throw or fail differently. `unauthenticated` is the pipeline's answer, not the handler's.
      for (const input of [{}, undefined, { slug: 'white-city-ballroom' }, { not: 'the schema' }]) {
        const { ctx, audit } = context(anonymous, surface);
        const result = await invoke(cap, ctx, input);
        expect(result.ok, `${name} on ${surface}`).toBe(false);
        if (!result.ok) expect(result.error.code, `${name} on ${surface}`).toBe('unauthenticated');
        expect(audit.find('capability.denied'), `${name} on ${surface}`).toHaveLength(1);
        expect(audit.find('capability.invoked'), `${name} on ${surface}`).toHaveLength(0);
      }
    }
  });

  it('leaves an anonymous caller exactly the story, navigation and the sign-in doors', () => {
    const open = registry.list({}).filter((c) => c.auth === 'anonymous').map((c) => c.name);
    expect(open).toEqual(ANONYMOUS_CAPABILITIES);
    // The same list by the route every surface takes: what `authorize` lets an anonymous principal run.
    expect(registry.list({ principal: anonymous }).map((c) => c.name)).toEqual(ANONYMOUS_CAPABILITIES);
    for (const name of WEDDING_DETAIL_CAPABILITIES) expect(open, name).not.toContain(name);
  });

  it('offers an assistant or a browser agent with no session nothing about the wedding', () => {
    for (const exposure of ['ai', 'webmcp'] as const) {
      const offered = registry.list({ exposure, principal: anonymous, flags }).map((c) => c.name);
      expect(offered, exposure).toEqual(ANONYMOUS_AGENT_CAPABILITIES);
      // ... and signed in, the same surface does offer them.
      const signedIn = registry.list({ exposure, principal: guest, flags }).map((c) => c.name);
      for (const name of WEDDING_DETAIL_CAPABILITIES) expect(signedIn, `${exposure}: ${name}`).toContain(name);
    }
  });

  it('lets the couple read what their guests read', () => {
    // `guest` is a floor, not an identity: an administrator is signed in, and none of these reads a
    // guest-owned row without checking for a guest principal itself.
    for (const name of WEDDING_DETAIL_CAPABILITIES) {
      const cap = capability(name);
      expect(cap.guestIdentityRequired ?? false, name).toBe(false);
      expect(authorize(cap, admin).ok, name).toBe(true);
    }
  });
});
