import { guestDisplayName } from '@/domain/guests/repo';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { formatEventDate, formatEventWindow } from '@/domain/events';
import { loadForPrincipal } from './context';
import { briefCitation, eventViewSchema, GUEST_READ_MAX_CHARS, plusOnePolicySchema, requireGuestPrincipal, toEventView } from './shared';

const input = z.object({}).optional();
const output = z.object({
  events: z.array(
    eventViewSchema.extend({
      whenText: z.string(),
      dateText: z.string(),
      invited: z.array(z.object({ guestId: z.string(), displayName: z.string(), plusOnePolicy: plusOnePolicySchema })),
    }),
  ),
});
export type MyEvents = z.infer<typeof output>;

export const listMyEvents = defineCapability<z.infer<typeof input>, MyEvents>({
  name: 'list_my_events',
  title: 'My events',
  description:
    'Lists the wedding events this guest (and the household they manage) is invited to, with times in America/Chicago, ' +
    'the room when confirmed, dress code, and who in the household is invited. Facts marked placeholder are not confirmed yet. Read-only.',
  kind: 'read',
  auth: 'guest',
  requires: ['view_event'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: GUEST_READ_MAX_CHARS,
  async handler(ctx) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const hc = await loadForPrincipal(ctx, p.value);
    const guestName = new Map(hc.guests.map((g) => [g.id, guestDisplayName(g)]));
    const events = hc.entitledEvents.map((e) => ({
      ...toEventView(e, hc.mealOptions),
      whenText: formatEventWindow(e.startsAt, e.endsAt, e.timezone),
      dateText: formatEventDate(e.dateIso, e.timezone),
      invited: hc.entitlements
        .filter((en) => en.eventId === e.id && guestName.has(en.guestId))
        .map((en) => ({ guestId: en.guestId, displayName: guestName.get(en.guestId)!, plusOnePolicy: en.plusOnePolicy })),
    }));
    return ok({ data: { events }, sources: [briefCitation(ctx.now)] });
  },
});
