'use server';

import { findAdventures } from '@/capabilities/find_adventures';
import { addTripItemCapability, removeTripItemCapability, updateTripItemCapability } from '@/capabilities/travel';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { newId } from '@/contracts/ids';
import { isWeddingTime, PART_HOURS, weekendDate, type Day, type Part } from '@/domain/trip-planner';
import { runAsUi } from './_shared/server';

/**
 * The planner's "My weekend", kept as the guest's own trip items: one `other` item per saved place,
 * marked `provider: 'planner'`, with the place and its part of the weekend in `details`. The item's
 * times are that part's planning block in the wedding's time zone, so `/trip` lists it on the right
 * day. Everything goes through the travel capabilities; nothing here decides who may write.
 */

export type PlannerSaveResult = { ok: true; itemId: string } | { ok: false; message: string };
export type PlannerRemoveResult = { ok: true } | { ok: false; message: string };

const DAYS: readonly Day[] = ['fri', 'sat', 'sun'];
const PARTS: readonly Part[] = ['morning', 'afternoon', 'evening'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const FAILED = 'We could not save that just now. Please try again in a moment.';
const PLAN_NOTE = 'Saved on Your Trip. The time is the part of the day you chose, not a booking.';

export async function savePlannerPlace(input: { placeId: string; day: Day; part: Part; itemId?: string | null }): Promise<PlannerSaveResult> {
  const placeId = typeof input?.placeId === 'string' ? input.placeId : '';
  const day = DAYS.includes(input?.day) ? input.day : null;
  const part = PARTS.includes(input?.part) ? input.part : null;
  if (!SLUG.test(placeId) || placeId.length > 80 || !day || !part) return { ok: false, message: FAILED };
  if (isWeddingTime(day, part)) return { ok: false, message: 'Saturday afternoon and evening are the wedding. Pick another time.' };

  // The title is the place's own, read back through the capability, never what the browser sent.
  const place = await runAsUi(findAdventures, { slug: placeId });
  const title = place.ok ? place.value.data.items[0]?.title : undefined;
  if (!title) return { ok: false, message: 'We could not find that place any more.' };

  const date = weekendDate(day);
  const hours = PART_HOURS[part];
  const item = {
    kind: 'other' as const,
    title,
    startAt: `${date}T${hours.start}`,
    endAt: `${date}T${hours.end}`,
    timezone: WEDDING_TIMEZONE,
    provider: 'planner',
    details: { placeId, day, part, note: PLAN_NOTE },
  };
  const itemId = typeof input.itemId === 'string' && ULID.test(input.itemId) ? input.itemId : null;
  const r = itemId
    ? await runAsUi(updateTripItemCapability, { action: 'edit', itemId, item }, { idempotencyKey: newId() })
    : await runAsUi(addTripItemCapability, item, { idempotencyKey: newId() });
  return r.ok ? { ok: true, itemId: r.value.data.id } : { ok: false, message: r.error.code === 'unauthenticated' ? 'Please sign in again to save your weekend.' : FAILED };
}

export async function removePlannerPlace(input: { itemId: string }): Promise<PlannerRemoveResult> {
  const itemId = typeof input?.itemId === 'string' && ULID.test(input.itemId) ? input.itemId : null;
  if (!itemId) return { ok: false, message: FAILED };
  const r = await runAsUi(removeTripItemCapability, { itemId }, { idempotencyKey: newId() });
  // Already gone is what the guest asked for.
  return r.ok || r.error.code === 'not_found' ? { ok: true } : { ok: false, message: 'We could not take that out just now. Please try again in a moment.' };
}
