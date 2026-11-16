/**
 * The schedule as a calendar reads: day by day, each day in the order things happen.
 *
 * Events carry a day (`dateIso`), optional start and end instants, and a hand-set `sortOrder`. A
 * timed event sits where its start puts it; one whose time is not decided yet follows the timed
 * ones, in the hand-set order, so "to be confirmed" never jumps ahead of a ceremony with a time.
 * Pure: the admin Schedule screen and its tests both call it.
 */
export interface AgendaEvent {
  id: string;
  dateIso: string;
  startsAt: string | null;
  sortOrder?: number;
}

export interface AgendaDay<E extends AgendaEvent> {
  dateIso: string;
  timed: E[];
  /** Events on this day with no start time yet, in their hand-set order. */
  untimed: E[];
}

export function agendaDays<E extends AgendaEvent>(events: readonly E[]): AgendaDay<E>[] {
  const days = new Map<string, AgendaDay<E>>();
  // `events` arrives in `sortOrder`; a stable walk keeps that order for the untimed ones.
  for (const e of events) {
    const day = days.get(e.dateIso) ?? { dateIso: e.dateIso, timed: [], untimed: [] };
    (e.startsAt ? day.timed : day.untimed).push(e);
    days.set(e.dateIso, day);
  }
  return [...days.values()]
    .map((d) => ({ ...d, timed: [...d.timed].sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!)) }))
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

/** What a guest would still read as "to be confirmed" for an event. */
export function undecided(e: { startsAt: string | null; venueSpaceRef: string | null; dressCode: string | null; description: string | null }): string[] {
  return [e.startsAt ? '' : 'time', e.venueSpaceRef ? '' : 'room', e.dressCode ? '' : 'dress code', !e.description || e.description.includes('TODO(') ? 'what happens' : ''].filter(Boolean);
}
