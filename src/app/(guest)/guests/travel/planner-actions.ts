'use server';

import { findAdventures } from '@/capabilities/find_adventures';
import { addTripItemCapability, getMyTrip, removeTripItemCapability, updateTripItemCapability } from '@/capabilities/travel';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { newId } from '@/contracts/ids';
import { WEDDING_DATE_ISO } from '@/contracts/lifecycle';
import { addDays, isWeddingTime, PART_HOURS, slotForDate, weekendDate, type Day, type Part } from '@/domain/trip-planner';
import { runAsUi } from './_shared/server';

/**
 * The planner's "My weekend", kept as the guest's own trip items: one `other` item per saved place,
 * marked `provider: 'planner'`, with the place and its part of the weekend in `details`. The item's
 * times are that part's planning block in the wedding's time zone, so `/trip` lists it on the right
 * day. Everything goes through the travel capabilities; nothing here decides who may write.
 *
 * The place is the key, never an item id from the page: a save updates this guest's planner row for
 * the place (or adds one), a remove deletes every planner row for it, and a row that is not the
 * planner's own (a flight, a hotel) is never edited or deleted from here, whatever the page sends.
 */

export type PlannerSaveResult = { ok: true; itemId: string } | { ok: false; message: string };
export type PlannerRemoveResult = { ok: true } | { ok: false; message: string };

const DAYS: readonly Day[] = ['fri', 'sat', 'sun'];
const PARTS: readonly Part[] = ['morning', 'afternoon', 'evening'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const FAILED = 'We could not save that just now. Please try again in a moment.';
const NOT_REMOVED = 'We could not take that out just now. Please try again in a moment.';
const SIGN_IN = 'Please sign in again to save your weekend.';
const PLAN_NOTE = 'Saved on Your Trip. The time is the part of the day you chose, not a booking.';

const placeIdOf = (input: { placeId?: unknown } | null | undefined) => {
  const placeId = typeof input?.placeId === 'string' ? input.placeId : '';
  return SLUG.test(placeId) && placeId.length <= 80 ? placeId : null;
};

/** This guest's planner rows for one place (their own trip, read through the capability); `live` is the one a save may update. */
async function plannerRows(placeId: string): Promise<{ ok: true; ids: string[]; live: string | null } | { ok: false; code: string }> {
  const trip = await runAsUi(getMyTrip, {});
  if (!trip.ok) return { ok: false, code: trip.error.code };
  const rows = trip.value.data.items.filter((i) => i.provider === 'planner' && i.details.placeId === placeId);
  return { ok: true, ids: rows.map((r) => r.id), live: rows.find((r) => r.status !== 'cancelled')?.id ?? null };
}

const removeRow = async (itemId: string) => {
  const r = await runAsUi(removeTripItemCapability, { itemId }, { idempotencyKey: newId() });
  // Already gone is what the guest asked for.
  return r.ok || r.error.code === 'not_found';
};

/** A day of a guest's stay: within a week either side of the wedding. */
const stayDate = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v >= addDays(WEDDING_DATE_ISO, -7) && v <= addDays(WEDDING_DATE_ISO, 7) ? v : null;
};

export async function savePlannerPlace(input: { placeId: string; day: Day; part: Part; date?: string }): Promise<PlannerSaveResult> {
  const placeId = placeIdOf(input);
  // A date before or after the weekend wins over the day; a weekend date is that day.
  const dated = input?.date === undefined ? null : stayDate(input.date);
  if (input?.date !== undefined && !dated) return { ok: false, message: FAILED };
  const slot = dated ? slotForDate(dated) : null;
  const day = slot ? slot.day : DAYS.includes(input?.day) ? input.day : null;
  const part = PARTS.includes(input?.part) ? input.part : null;
  if (!placeId || !day || !part) return { ok: false, message: FAILED };
  if (!slot?.date && isWeddingTime(day, part)) return { ok: false, message: 'Saturday afternoon and evening are the wedding. Pick another time.' };

  // The title is the place's own, read back through the capability, never what the browser sent.
  const place = await runAsUi(findAdventures, { slug: placeId });
  const title = place.ok ? place.value.data.items[0]?.title : undefined;
  if (!title) return { ok: false, message: 'We could not find that place any more.' };

  const date = slot?.date ?? weekendDate(day);
  const hours = PART_HOURS[part];
  const item = {
    kind: 'other' as const,
    title,
    startAt: `${date}T${hours.start}`,
    endAt: `${date}T${hours.end}`,
    timezone: WEDDING_TIMEZONE,
    provider: 'planner',
    details: { placeId, day, part, ...(slot?.date ? { date: slot.date } : {}), note: PLAN_NOTE },
  };
  const rows = await plannerRows(placeId);
  if (!rows.ok) return { ok: false, message: rows.code === 'unauthenticated' ? SIGN_IN : FAILED };
  const keep = rows.live;
  const extra = rows.ids.filter((id) => id !== keep);
  let r = keep ? await runAsUi(updateTripItemCapability, { action: 'edit', itemId: keep, item }, { idempotencyKey: newId() }) : null;
  // Gone since the read (removed in another tab): add it afresh.
  if (!r || (!r.ok && r.error.code === 'not_found')) r = await runAsUi(addTripItemCapability, item, { idempotencyKey: newId() });
  if (!r.ok) return { ok: false, message: r.error.code === 'unauthenticated' ? SIGN_IN : FAILED };
  // Duplicates (from before saves were keyed on the place) and cancelled copies: one row per place.
  for (const id of extra) await removeRow(id);
  return { ok: true, itemId: r.value.data.id };
}

export async function removePlannerPlace(input: { placeId: string }): Promise<PlannerRemoveResult> {
  const placeId = placeIdOf(input);
  if (!placeId) return { ok: false, message: NOT_REMOVED };
  const rows = await plannerRows(placeId);
  if (!rows.ok) return { ok: false, message: rows.code === 'unauthenticated' ? SIGN_IN : NOT_REMOVED };
  for (const id of rows.ids) if (!(await removeRow(id))) return { ok: false, message: NOT_REMOVED };
  return { ok: true };
}
