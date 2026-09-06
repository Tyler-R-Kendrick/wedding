/**
 * Itinerary composition: pure functions over recommendation cards. Used by
 * `find_adventures` (compose a plan for "I have 2 hours and kids") and by tests.
 */
export interface Composable {
  id: string;
  interests: readonly string[];
  durationMinutes: number | null;
  kidFriendly: boolean | null;
  draft: boolean;
  placeholder: boolean;
}

export interface ComposeOptions {
  /** Time available. Stops are added while the running total fits. */
  maxMinutes?: number;
  /** Interest tags; matching stops rank first. */
  interests?: readonly string[];
  /** When true, stops flagged not kid-friendly are excluded; unknown (null) stays but ranks lower. */
  kids?: boolean;
  /** Fallback length for stops without a duration. */
  defaultMinutes?: number;
  /** Cap on the number of stops. */
  maxStops?: number;
}

export interface ComposedStop<T extends Composable> {
  item: T;
  minutes: number;
}

export interface ComposedItinerary<T extends Composable> {
  stops: ComposedStop<T>[];
  totalMinutes: number;
  /** Ids that matched but did not fit the time budget. */
  skippedForTime: string[];
}

export function interestScore(item: Composable, interests: readonly string[] | undefined): number {
  if (!interests?.length) return 0;
  const wanted = new Set(interests.map((i) => i.toLowerCase()));
  return item.interests.reduce((n, i) => n + (wanted.has(i.toLowerCase()) ? 1 : 0), 0);
}

/** Rank: interest matches, then kid-friendliness when asked, then non-placeholder, then shorter first. */
export function rankForComposition<T extends Composable>(items: readonly T[], opts: ComposeOptions): T[] {
  const filtered = items.filter((i) => !(opts.kids && i.kidFriendly === false));
  return [...filtered].sort((a, b) => {
    const s = interestScore(b, opts.interests) - interestScore(a, opts.interests);
    if (s !== 0) return s;
    if (opts.kids) {
      const k = Number(b.kidFriendly === true) - Number(a.kidFriendly === true);
      if (k !== 0) return k;
    }
    const p = Number(a.placeholder) - Number(b.placeholder);
    if (p !== 0) return p;
    return (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity);
  });
}

/**
 * Greedy composition inside a time budget. Deterministic: the same inputs always produce the
 * same plan, which keeps the AI surface auditable.
 */
export function composeItinerary<T extends Composable>(items: readonly T[], opts: ComposeOptions = {}): ComposedItinerary<T> {
  const ranked = rankForComposition(items, opts);
  const budget = opts.maxMinutes ?? Infinity;
  const fallback = opts.defaultMinutes ?? 45;
  const maxStops = opts.maxStops ?? 6;
  const stops: ComposedStop<T>[] = [];
  const skippedForTime: string[] = [];
  let total = 0;
  for (const item of ranked) {
    if (stops.length >= maxStops) break;
    const minutes = item.durationMinutes ?? fallback;
    if (total + minutes > budget) {
      skippedForTime.push(item.id);
      continue;
    }
    stops.push({ item, minutes });
    total += minutes;
  }
  return { stops, totalMinutes: total, skippedForTime };
}

/** Sum of a curated template's stop minutes (stop override, else the recommendation's duration, else fallback). */
export function totalMinutes(stops: readonly { minutes?: number; durationMinutes: number | null }[], fallback = 45): number {
  return stops.reduce((n, s) => n + (s.minutes ?? s.durationMinutes ?? fallback), 0);
}

/** Human duration ("45 min", "2 h 30 min"). */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
