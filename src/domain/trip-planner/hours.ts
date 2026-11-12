/**
 * Opening hours as OpenStreetMap writes them ("Mo-Fr 07:00-19:00; Sa 08:00-14:00; Su off"), read
 * far enough to say whether a place is known to be shut at the time a guest asked about. Anything
 * this does not understand is unknown, and unknown is never treated as shut.
 */
const DAY_INDEX: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
type Week = [number, number][][];

function daysOf(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = /^([a-z]{2})(?:-([a-z]{2}))?$/.exec(part.trim());
    if (!m) return null;
    const from = DAY_INDEX[m[1]!];
    const to = m[2] ? DAY_INDEX[m[2]] : from;
    if (from === undefined || to === undefined) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === to) break;
    }
  }
  return [...out];
}

/** The week's open spans in minutes from midnight (a span past midnight runs over 1440), or null when the text is not understood. */
export function parseHours(text: string | undefined): Week | null {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === '24/7') return Array.from({ length: 7 }, () => [[0, 1440]] as [number, number][]);
  const week: Week = Array.from({ length: 7 }, () => []);
  let any = false;
  for (const rule of raw.split(';')) {
    const r = rule.trim();
    if (!r || /^ph\b/.test(r)) continue;
    const m = /^((?:[a-z]{2}(?:-[a-z]{2})?)(?:\s*,\s*[a-z]{2}(?:-[a-z]{2})?)*)?\s*(.*)$/.exec(r);
    if (!m) return null;
    const days = m[1] ? daysOf(m[1].replace(/\s+/g, '')) : [0, 1, 2, 3, 4, 5, 6];
    if (!days) return null;
    const rest = m[2]!.trim();
    if (rest === 'off' || rest === 'closed') {
      for (const d of days) week[d] = [];
      any = true;
      continue;
    }
    const spans: [number, number][] = [];
    for (const t of rest.split(',')) {
      const s = /^(\d{1,2}):(\d\d)\s*-\s*(\d{1,2}):(\d\d)$/.exec(t.trim());
      if (!s) return null;
      const from = Number(s[1]) * 60 + Number(s[2]);
      let to = Number(s[3]) * 60 + Number(s[4]);
      if (to <= from) to += 1440;
      spans.push([from, to]);
    }
    // A later rule for a day replaces an earlier one, as the format says.
    for (const d of days) week[d] = spans;
    any = true;
  }
  return any ? week : null;
}

/** A time a guest asked about: a day of the week (Monday is 0) and a span of it in minutes from midnight. */
export type AskedTime = { weekday: number; from: number; to: number };

/** False only when the hours are understood and the place is shut for the whole of the asked time. */
export function mayBeOpen(hours: string | undefined, at: AskedTime | null | undefined): boolean {
  if (!at) return true;
  const week = parseHours(hours);
  if (!week) return true;
  const overlaps = (spans: [number, number][], from: number, to: number) => spans.some(([a, b]) => a < to && b > from);
  // Today's hours, or yesterday's running on past midnight.
  return overlaps(week[at.weekday]!, at.from, at.to) || overlaps(week[(at.weekday + 6) % 7]!, at.from + 1440, at.to + 1440);
}

const WEEKDAY: [RegExp, number][] = [
  [/\bmon(day)?s?\b/, 0],
  [/\btue(s|sday)?s?\b/, 1],
  [/\bwed(nesday)?s?\b/, 2],
  [/\bthu(r|rs|rsday)?s?\b/, 3],
  [/\bfri(day)?s?\b/, 4],
  [/\bsat(urday)?s?\b/, 5],
  [/\bsun(day)?s?\b/, 6],
];
const PART_SPAN: Record<string, [number, number]> = { morning: [8 * 60, 12 * 60], afternoon: [12 * 60, 17 * 60], evening: [18 * 60, 22 * 60] };

/**
 * The day of the week a request is about, Monday as 0, or null: the first one it names, passing
 * over a day that only bounds the stay ("staying till Wednesday") when another is named.
 */
export function weekdayIn(text: string): number | null {
  let best: { at: number; day: number; bound: boolean } | null = null;
  for (const [re, day] of WEEKDAY) {
    const m = re.exec(text);
    if (!m) continue;
    const bound = /\b(till|until|through|thru|before|leav(e|ing)( on)?|fly(ing)? (home|out|back)( on)?)\s+$/.test(text.slice(0, m.index));
    if (!best || (best.bound && !bound) || (best.bound === bound && m.index < best.at)) best = { at: m.index, day, bound };
  }
  return best ? best.day : null;
}

/**
 * The time a request asks about, when it names a day: a clock time ("6am", "11pm", "1am on Friday
 * night" is the small hours of Saturday), else the part of the day, else the whole waking day.
 */
export function askedTime(text: string, part: string | undefined): AskedTime | null {
  const weekday = weekdayIn(text);
  if (weekday === null) return null;
  const clock = /\b(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\b/.exec(text);
  if (clock) {
    const h = (Number(clock[1]) % 12) + (clock[3] === 'p' ? 12 : 0);
    const at = h * 60 + Number(clock[2] ?? 0);
    // "1am Friday night" is after Friday's midnight.
    const small = h < 5 && /\b(night|late|tonight|after the bars?)\b/.test(text);
    return { weekday: small ? (weekday + 1) % 7 : weekday, from: at, to: at + 30 };
  }
  if (/\bmidnight\b/.test(text)) return { weekday: (weekday + 1) % 7, from: 0, to: 30 };
  if (/\b(late[- ]night|late at night)\b/.test(text)) return { weekday, from: 22 * 60, to: 24 * 60 };
  if (/\bnight\b/.test(text) && part === 'evening') return { weekday, from: 19 * 60, to: 23 * 60 };
  const span = part ? PART_SPAN[part] : undefined;
  return span ? { weekday, from: span[0], to: span[1] } : { weekday, from: 9 * 60, to: 21 * 60 };
}

/** A part of a day as a span of the clock, for asking whether a place is open then. */
export function partTime(weekday: number, part: string): AskedTime {
  const [from, to] = PART_SPAN[part] ?? [9 * 60, 21 * 60];
  return { weekday, from, to };
}

/** The day of the week a calendar date falls on, Monday as 0. */
export function weekdayOfDate(dateIso: string): number {
  return (new Date(`${dateIso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Whether a place is open in a part of a day: true or false when its hours are understood, null
 * when they are not held (which is never read as shut).
 */
export function openIn(hours: string | undefined, weekday: number, part: string): boolean | null {
  if (!parseHours(hours)) return null;
  return mayBeOpen(hours, partTime(weekday, part));
}

/** Whether a place opens at all on a day of the week; null when its hours are not held. */
export function openOnDay(hours: string | undefined, weekday: number): boolean | null {
  const week = parseHours(hours);
  return week ? week[weekday]!.length > 0 : null;
}
