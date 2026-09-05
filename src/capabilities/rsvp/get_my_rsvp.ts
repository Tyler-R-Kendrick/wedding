import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { RSVP_STATUSES } from '@/db/schema';
import { formatEventDate, formatEventWindow } from '@/domain/events';
import { loadForPrincipal } from './context';
import { briefCitation, eventViewSchema, GUEST_READ_MAX_CHARS, plusOnePolicySchema, requireGuestPrincipal, toEventView, windowSchema } from './shared';

const input = z.object({}).optional();
const output = z.object({
  window: windowSchema,
  household: z.object({ id: z.string(), name: z.string() }),
  guests: z.array(z.object({ guestId: z.string(), displayName: z.string(), firstName: z.string(), isMinor: z.boolean(), isSelf: z.boolean() })),
  events: z.array(eventViewSchema.extend({ whenText: z.string(), dateText: z.string(), invited: z.array(z.object({ guestId: z.string(), plusOnePolicy: plusOnePolicySchema })) })),
  responses: z.array(
    z.object({
      guestId: z.string(),
      eventId: z.string(),
      status: z.enum(RSVP_STATUSES),
      mealOptionId: z.string().nullable(),
      mealLabel: z.string().nullable(),
      /** The menu changed since this choice; the guest should choose again. */
      mealStale: z.boolean(),
      plusOne: z.object({ attending: z.boolean(), name: z.string().nullable(), mealOptionId: z.string().nullable(), mealLabel: z.string().nullable() }).nullable(),
      updatedAt: z.string(),
      version: z.number(),
    }),
  ),
  /** Sensitive; only the household's own rows, only on the UI surface. */
  needs: z.array(z.object({ guestId: z.string(), dietary: z.string().nullable(), accessibility: z.string().nullable() })),
  lastSubmittedAt: z.string().nullable(),
});
export type MyRsvp = z.infer<typeof output>;

export const getMyRsvp = defineCapability<z.infer<typeof input>, MyRsvp>({
  name: 'get_my_rsvp',
  title: 'My RSVP',
  description:
    "Returns the guest's household RSVP: who is in the household, which events each person is invited to, the current meal options, " +
    'the answers already on file, and whether RSVPs are open. Read-only; use draft_rsvp to propose changes. Dietary and accessibility notes are shown only on the website, never to assistants.',
  kind: 'read',
  auth: 'guest',
  requires: ['rsvp_self'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: GUEST_READ_MAX_CHARS,
  async handler(ctx) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const hc = await loadForPrincipal(ctx, p.value);
    const mealLabel = new Map(hc.mealOptions.map((m) => [m.id, m.label]));
    const eventById = new Map(hc.events.map((e) => [e.id, e]));
    const responses = hc.responses
      .filter((r) => eventById.has(r.eventId))
      .map((r) => ({
        guestId: r.guestId,
        eventId: r.eventId,
        status: r.status,
        mealOptionId: r.mealOptionId,
        mealLabel: r.mealOptionId ? (mealLabel.get(r.mealOptionId) ?? null) : null,
        mealStale: r.mealOptionId !== null && r.mealOptionsVersion !== eventById.get(r.eventId)!.mealOptionsVersion,
        plusOne: r.plusOneAttending || r.plusOneName ? { attending: r.plusOneAttending, name: r.plusOneName, mealOptionId: r.plusOneMealOptionId, mealLabel: r.plusOneMealOptionId ? (mealLabel.get(r.plusOneMealOptionId) ?? null) : null } : null,
        updatedAt: r.updatedAt.toISOString(),
        version: r.version,
      }));
    const last = hc.responses.reduce<Date | null>((acc, r) => (!acc || r.updatedAt > acc ? r.updatedAt : acc), null);
    const surface = ctx.surface ?? 'ui';
    return ok({
      data: {
        window: hc.window,
        household: { id: hc.household?.id ?? p.value.householdId, name: hc.household?.name ?? 'Your household' },
        guests: hc.guests.map((g) => ({ guestId: g.id, displayName: g.displayName, firstName: g.firstName, isMinor: g.isMinor, isSelf: g.id === p.value.guestId })),
        events: hc.entitledEvents.map((e) => ({
          ...toEventView(e, hc.mealOptions),
          whenText: formatEventWindow(e.startsAt, e.endsAt, e.timezone),
          dateText: formatEventDate(e.dateIso, e.timezone),
          invited: hc.entitlements.filter((en) => en.eventId === e.id).map((en) => ({ guestId: en.guestId, plusOnePolicy: en.plusOnePolicy })),
        })),
        responses,
        // Needs never leave the website surface (AI/WebMCP get an empty list).
        needs: surface === 'ui' ? hc.needs.map((n) => ({ guestId: n.guestId, dietary: n.dietary, accessibility: n.accessibility })) : [],
        lastSubmittedAt: last ? last.toISOString() : null,
      },
      sources: [briefCitation(ctx.now)],
    });
  },
});
