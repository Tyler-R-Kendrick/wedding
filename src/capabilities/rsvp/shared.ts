import { placeholderHint } from '@/components/provenance/Placeholder';
import { z } from 'zod';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import type { GuestPrincipal } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Citation } from '@/contracts/provenance';
import { PLUS_ONE_POLICIES, RSVP_WINDOW_MODES, type EventRow, type MealOptionRow } from '@/db/schema';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { BRIEF_SOURCE_ID } from '@/db/seed/sources';
import { currentMealOptions } from '@/domain/events';

export const idSchema = z.string().regex(ID_PATTERN, 'must be an id');

/** Guest-facing capabilities are for guests only: admins use the admin surfaces, never a guest's private view. */
export function requireGuestPrincipal(ctx: CapabilityContext): Result<GuestPrincipal, CapabilityError> {
  const p = ctx.principal;
  if (p.kind === 'anonymous') return err(new CapabilityError('unauthenticated', 'Please sign in to continue.'));
  if (p.kind !== 'guest') return err(new CapabilityError('forbidden', 'This area is for invited guests.'));
  return ok(p);
}

export const windowSchema = z.object({
  open: z.boolean(),
  reason: z.enum(['manual_open', 'manual_closed', 'lifecycle', 'deadline_passed', 'scheduled']),
  mode: z.enum(RSVP_WINDOW_MODES),
  deadlineAt: z.string().nullable(),
  lifecycle: z.enum(LIFECYCLE_STATES),
});

export const mealOptionSchema = z.object({ id: z.string(), label: z.string(), description: z.string().nullable() });

export const eventViewSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  dateIso: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timezone: z.string(),
  venueSpaceRef: z.string().nullable(),
  dressCode: z.string().nullable(),
  accessibilityNote: z.string().nullable(),
  placeholder: z.boolean(),
  rsvpRequired: z.boolean(),
  hasMeal: z.boolean(),
  mealOptionsVersion: z.number(),
  sortOrder: z.number(),
  mealOptions: z.array(mealOptionSchema),
});
export type EventView = z.infer<typeof eventViewSchema>;

/**
 * The guest-facing view of an event.
 *
 * `description` is scrubbed of the authoring marker here, at the boundary, rather than in the
 * component that happens to render it. `TODO(Tyler & Sara)` is how a content record says "not a
 * fact yet" — `placeholder: true` below is the signal a caller should read — and it has no business
 * leaving the server on a guest surface. It was reaching the RSC payload of a page that does not
 * even render the field, and these capabilities are exposed to `ai` and `webmcp`, so it would have
 * reached assistant transcripts too. Admin surfaces build their own view and still see the record
 * verbatim, which is where the marker is useful.
 */
export function toEventView(e: EventRow, allMeals: readonly MealOptionRow[]): EventView {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description ? placeholderHint(e.description) : e.description,
    dateIso: e.dateIso,
    startsAt: e.startsAt ? e.startsAt.toISOString() : null,
    endsAt: e.endsAt ? e.endsAt.toISOString() : null,
    timezone: e.timezone,
    venueSpaceRef: e.venueSpaceRef,
    dressCode: e.dressCode,
    accessibilityNote: e.accessibilityNote,
    placeholder: e.placeholder,
    rsvpRequired: e.rsvpRequired,
    hasMeal: e.hasMeal,
    mealOptionsVersion: e.mealOptionsVersion,
    sortOrder: e.sortOrder,
    mealOptions: currentMealOptions(e, allMeals).map((m) => ({ id: m.id, label: m.label, description: m.description })),
  };
}

export const plusOnePolicySchema = z.enum(PLUS_ONE_POLICIES);

/** Event facts trace to the brief until the couple confirms them (ADR-0011). */
export const briefCitation = (verifiedAt: Date): Citation => ({ sourceId: BRIEF_SOURCE_ID as Citation['sourceId'], title: "Tyler's brief 2026-09-04", url: '/the-wedding', verifiedAt: verifiedAt.toISOString() });

export const GUEST_READ_MAX_CHARS = 12_000;
