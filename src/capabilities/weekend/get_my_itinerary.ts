import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { err, ok } from '@/contracts/result';
import { eDb } from '@/capabilities/rsvp/db';
import { NOTICE_SEVERITIES, RSVP_STATUSES } from '@/db/schema';
import { formatEventDate, formatEventWindow, listActiveNotices } from '@/domain/events';
import { getLifecycle } from '@/db/repos/site';
import { resolveWeekendSlots, WEEKEND_SLOT_KINDS } from '@/domain/weekend';
import { loadForPrincipal } from '@/capabilities/rsvp/context';
import { briefCitation, eventViewSchema, GUEST_READ_MAX_CHARS, requireGuestPrincipal, windowSchema } from '@/capabilities/rsvp/shared';
import { myTableSchema, readPublishedTable } from '@/capabilities/seating/get_my_table';

const input = z.object({}).optional();

const slotSchema = z.discriminatedUnion('status', [
  z.object({ kind: z.enum(WEEKEND_SLOT_KINDS), status: z.literal('placeholder'), placeholder: z.literal(true), title: z.string(), body: z.string(), owner: z.string() }),
  z.object({ kind: z.enum(WEEKEND_SLOT_KINDS), status: z.literal('ready'), placeholder: z.literal(false), title: z.string(), items: z.array(z.object({ label: z.string(), detail: z.string().optional(), href: z.string().optional() })), retrievedAt: z.string().optional() }),
  z.object({ kind: z.enum(WEEKEND_SLOT_KINDS), status: z.literal('unavailable'), placeholder: z.literal(false), title: z.string(), body: z.string() }),
]);

const output = z.object({
  greeting: z.object({ firstName: z.string(), householdName: z.string() }),
  lifecycle: z.enum(LIFECYCLE_STATES),
  rsvp: z.object({
    window: windowSchema,
    status: z.enum(['not_started', 'partial', 'complete']),
    answered: z.number(),
    expected: z.number(),
  }),
  events: z.array(
    eventViewSchema.extend({
      whenText: z.string(),
      dateText: z.string(),
      household: z.array(z.object({ guestId: z.string(), displayName: z.string(), isSelf: z.boolean(), status: z.enum(RSVP_STATUSES).nullable() })),
    }),
  ),
  seating: z.object({ published: z.boolean(), table: myTableSchema.nullable() }),
  slots: z.object({ transport: slotSchema, trip: slotSchema }),
  notices: z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), severity: z.enum(NOTICE_SEVERITIES), startsAt: z.string().nullable(), endsAt: z.string().nullable() })),
});
export type MyItinerary = z.infer<typeof output>;

export const getMyItinerary = defineCapability<z.infer<typeof input>, MyItinerary>({
  name: 'get_my_itinerary',
  title: 'Your Weekend',
  description:
    "The guest's personal weekend: the events they are invited to with times in America/Chicago, the household's RSVP status, their table once seating is published, " +
    'ride and trip sections (placeholders until those tools are live), and any urgent notices from the couple. Read-only.',
  kind: 'read',
  auth: 'guest',
  requires: ['view_private_schedule'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: GUEST_READ_MAX_CHARS,
  async handler(ctx) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const db = await eDb(ctx);
    const [hc, lifecycleRow, notices, slots, table] = await Promise.all([
      loadForPrincipal(ctx, p.value),
      getLifecycle(db),
      listActiveNotices(db, ctx.now),
      resolveWeekendSlots({ principal: ctx.principal, guestId: p.value.guestId, db, now: ctx.now }),
      p.value.entitlements.has('view_table_assignment') ? readPublishedTable(ctx, p.value.guestId) : Promise.resolve(null),
    ]);
    const self = hc.guests.find((g) => g.id === p.value.guestId);
    const responseKey = new Map(hc.responses.map((r) => [`${r.guestId}::${r.eventId}`, r.status]));
    const expectedPairs = hc.entitlements.filter((en) => hc.entitledEvents.some((e) => e.id === en.eventId && e.rsvpRequired));
    const answered = expectedPairs.filter((en) => responseKey.has(`${en.guestId}::${en.eventId}`)).length;
    const status = answered === 0 ? 'not_started' : answered < expectedPairs.length ? 'partial' : 'complete';
    const guestName = new Map(hc.guests.map((g) => [g.id, g.displayName]));
    return ok({
      data: {
        greeting: { firstName: self?.firstName ?? 'there', householdName: hc.household?.name ?? 'Your household' },
        lifecycle: lifecycleRow?.state ?? 'TEASER',
        rsvp: { window: hc.window, status, answered, expected: expectedPairs.length },
        events: hc.entitledEvents.map((e) => ({
          ...toEventViewLocal(e, hc.mealOptions),
          whenText: formatEventWindow(e.startsAt, e.endsAt, e.timezone),
          dateText: formatEventDate(e.dateIso, e.timezone),
          household: hc.entitlements
            .filter((en) => en.eventId === e.id && guestName.has(en.guestId))
            .map((en) => ({ guestId: en.guestId, displayName: guestName.get(en.guestId)!, isSelf: en.guestId === p.value.guestId, status: responseKey.get(`${en.guestId}::${e.id}`) ?? null })),
        })),
        seating: { published: !!table, table: table?.data ?? null },
        slots,
        notices: notices.map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, startsAt: n.startsAt?.toISOString() ?? null, endsAt: n.endsAt?.toISOString() ?? null })),
      },
      sources: [briefCitation(ctx.now)],
    });
  },
});

import { toEventView as toEventViewLocal } from '@/capabilities/rsvp/shared';
