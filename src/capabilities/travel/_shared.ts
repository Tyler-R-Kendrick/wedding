import { z } from 'zod';
import { appServices } from '@/capabilities/context';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { assertActsFor } from '@/policy/entitlements';
import type { FlightsProvider } from '@/providers/flights/types';
import type { HotelsProvider } from '@/providers/hotels/types';

/** Services every travel capability reaches through the pipeline context (never a concrete adapter). */
export interface TravelServices {
  db: Db;
  flights: FlightsProvider;
  hotels: HotelsProvider;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export function travelServices(ctx: CapabilityContext): TravelServices {
  const s = appServices(ctx);
  return {
    db: s.db,
    flights: s.providers('flights'),
    hotels: s.providers('hotels'),
    warn: (obj, msg) => s.logger?.warn(obj, msg),
  };
}

/** `note` is a confirmed fact; `pending` is what is still to be decided, in the guest's words. */
export const airportOutput = z.object({ code: z.string(), name: z.string(), note: z.string().nullable(), pending: z.string().nullable() });

const SIGN_IN = 'Please sign in to continue.';

/**
 * Which guest a "my" capability is about. Guests act for themselves or for the household
 * members in `actsFor`; admins with `admin_guest_ops` must name the guest. Row ownership is
 * re-checked here on every call: hidden UI is never authorization.
 */
export function resolveGuestTarget(ctx: CapabilityContext, guestId?: string): Result<{ guestId: GuestId; householdId: HouseholdId | null }, CapabilityError> {
  const p = ctx.principal;
  if (p.kind === 'anonymous') return err(new CapabilityError('unauthenticated', SIGN_IN));
  if (p.kind === 'guest') {
    const target = (guestId ?? p.guestId) as GuestId;
    const owns = assertActsFor(p, target);
    if (!owns.ok) return err(owns.error);
    return ok({ guestId: target, householdId: p.householdId });
  }
  if (!guestId) return err(new CapabilityError('validation', 'Say which guest this is for.', { issues: [{ path: 'guestId', message: 'required for administrators' }] }));
  const owns = assertActsFor(p, guestId as GuestId);
  if (!owns.ok) return err(owns.error);
  return ok({ guestId: guestId as GuestId, householdId: null });
}

/** Writes to guest-owned rows need the household id, which only a guest principal carries: admins read, guests write. */
export function requireGuestWriter(ctx: CapabilityContext, guestId?: string): Result<{ guestId: GuestId; householdId: HouseholdId; principal: GuestPrincipal }, CapabilityError> {
  const p = ctx.principal;
  if (p.kind === 'anonymous') return err(new CapabilityError('unauthenticated', SIGN_IN));
  if (p.kind !== 'guest') return err(new CapabilityError('forbidden', 'Only the guest can change this.'));
  const target = (guestId ?? p.guestId) as GuestId;
  const owns = assertActsFor(p, target);
  if (!owns.ok) return err(owns.error);
  return ok({ guestId: target, householdId: p.householdId, principal: p });
}

/** Ownership of an existing guest-owned row. Not owned reads as not found so ids cannot be probed. */
export function assertOwnsRow(ctx: CapabilityContext, rowGuestId: GuestId): Result<void, CapabilityError> {
  return assertActsFor(ctx.principal, rowGuestId).ok ? ok(undefined) : err(new CapabilityError('not_found', 'That trip item was not found.'));
}

export const providerFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'partner';
  }
};
