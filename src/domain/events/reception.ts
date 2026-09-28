import type { EventRow } from '@/db/schema';

/** The key the reception goes by: the seed's, and the one a new event named "Reception" is given. */
export const RECEPTION_SLUG = 'reception';

/**
 * The reception, found by what survives the couple's edits rather than by the seed's id: the
 * seeded reception can be deleted in /admin/events (`admin_delete_event`) while nobody has
 * answered it, and one they add again gets a new id. In order: the event keyed `reception` (a key
 * is kept through a rename, and invitation links name events by it), then one named "Reception",
 * then the only event that serves a meal. Null when none of those picks out one event.
 */
export function findReception<E extends Pick<EventRow, 'id' | 'slug' | 'name' | 'hasMeal'>>(evs: readonly E[]): E | null {
  const bySlug = evs.find((e) => e.slug === RECEPTION_SLUG);
  if (bySlug) return bySlug;
  const byName = evs.filter((e) => e.name.trim().toLowerCase() === 'reception');
  if (byName.length === 1) return byName[0]!;
  const meals = evs.filter((e) => e.hasMeal);
  return meals.length === 1 ? meals[0]! : null;
}
