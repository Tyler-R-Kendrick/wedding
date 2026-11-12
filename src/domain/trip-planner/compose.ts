import { fitIn } from './draft';
import { DAY_NAME, dateLabel, weekendDate } from './facts';
import { aboutHowLong, clockSpan, planRoute, routeFacts, type Leg } from './route';
import { scheduleOf } from './schedule';
import { DAYS, PARTS, type ComposeContext, type Day, type Part, type Plan, type PlanPick, type PlannerPlace } from './types';

/**
 * A plan as an OpenUI Lang program for the site's own component library (src/components/trip/openui).
 * It accepts any partial plan: missing text becomes "", unknown place ids are left out, and every
 * statement it writes is referenced from root.
 */

/** A string literal: OpenUI Lang reads double-quoted strings as JSON, so JSON's escaping is exact. */
export const str = (value: unknown) => JSON.stringify(typeof value === 'string' ? value : value == null ? '' : String(value));
const num = (n: number) => (Number.isFinite(n) ? String(Number(n.toFixed(6))) : '0');
const opt = (value: string | undefined | null) => (value ? str(value) : 'null');
const list = (items: string[]) => `[${items.join(', ')}]`;

const PART_LABEL: Record<Part, string> = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };
const isDay = (d: unknown): d is Day => d === 'fri' || d === 'sat' || d === 'sun';

type Program = { root: string[]; lines: string[]; state: string[] };

function begin(plan: Plan): Program {
  const p: Program = { root: ['head'], lines: [], state: [] };
  const intro = plan.intro ? `, Text(${str(plan.intro)}, "md", "muted")` : '';
  p.lines.push(`head = Col([Title(${str(plan.title)}, "xl")${intro}], 2)`);
  return p;
}

function end(p: Program, plan: Plan): string {
  const next = (plan.next ?? []).filter((n) => typeof n === 'string' && n.trim()).slice(0, 3);
  if (next.length) {
    p.root.push('next');
    p.lines.push(`next = Next(${list(next.map(str))})`);
  }
  return [`root = Col(${list(p.root)})`, ...p.state, ...p.lines].join('\n');
}

function placeCall(pick: PlanPick, note: boolean = true): string {
  const args = [str(pick.id), note ? opt(pick.note) : 'null'];
  if (pick.day || pick.part) args.push(opt(pick.day), opt(pick.part));
  while (args.length > 1 && args[args.length - 1] === 'null') args.pop();
  return `Place(${args.join(', ')})`;
}

function knownPicks(plan: Plan, ctx: ComposeContext, max = 6): PlanPick[] {
  const seen = new Set<string>();
  return (plan.picks ?? []).filter((p) => p && typeof p.id === 'string' && ctx.places.has(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, max);
}

function grid(picks: PlanPick[], note = true): string {
  return `Grid(${list(picks.map((p) => placeCall(p, note)))})`;
}

/** About 40 m: closer than this, two places are in the same building. */
const SAME_SPOT = 0.0004;

/** A map for two or more located places, bound to `$stop` with a caption that reads it. */
function addMap(p: Program, picks: PlanPick[], ctx: ComposeContext, route: boolean) {
  const located = picks.map((x) => ctx.places.get(x.id)!).filter((pl) => typeof pl.lat === 'number' && typeof pl.lng === 'number');
  if (located.length < 2) return;
  // Places that all share one spot (everything inside the hotel) make a map that says nothing.
  const [first] = located;
  if (located.every((pl) => Math.abs(pl.lat! - first!.lat!) < SAME_SPOT && Math.abs(pl.lng! - first!.lng!) < SAME_SPOT)) return;
  p.state.push('$stop = ""');
  p.root.push('map');
  // Every stop, in the plan's order, so the map's numbers are the cards' order. A stop without
  // coordinates is listed under the map with its number but gets no pin.
  const markers = picks.map((x) => {
    const pl = ctx.places.get(x.id)!;
    const hasSpot = typeof pl.lat === 'number' && typeof pl.lng === 'number';
    return hasSpot ? `MapMarker(${str(pl.name)}, ${num(pl.lat!)}, ${num(pl.lng!)}, ${str(pl.id)})` : `MapMarker(${str(pl.name)}, null, null, ${str(pl.id)})`;
  });
  p.lines.push(`map = Map(${list(markers)}, ${route ? 'true' : 'false'}, $stop)`);
}

const MORE = ['', 'One more from our list', 'Two more from our list', 'Three more from our list'];
/** A route's places that did not fit its part of the day. */
const LATER = ['', 'One more idea', 'Two more ideas', 'Three more ideas'];

/** A leg as a sentence that ends at its destination: "Walk about 10–15 minutes (0.6 mi) to Shedd Aquarium." */
function legLine(leg: Leg, to: string): string {
  return leg.mode === 'same' ? `${to} is right there: same building or next door.` : `${leg.text} to ${to}.`;
}

/** The part of the day every stop shares, if they share one. */
function sharedPart(picks: PlanPick[]): PlanPick['part'] | null {
  const [first] = picks;
  return first?.part && picks.every((p) => p.part === first.part && p.day === first.day) ? first.part : null;
}

/**
 * Stops as a day, the way a good day plan reads: when to start, how long it all takes and how much
 * of it is on foot (chips), then each stop numbered with its time and how long it takes, and between
 * stops how to get to the next one and how long that takes. From the hotel and back to it when the
 * hotel's position is known. `labels` (a stop's part of the day) stands in for clock times when the
 * stops do not share one part.
 */
function routeLines(p: Program, name: string, picks: PlanPick[], ctx: ComposeContext, opts: { facts: boolean; back: boolean; labels?: boolean; between?: () => void; inline?: boolean; timeless?: boolean }): void {
  // `timeless`: the guest named a length of time, not when; the stops get no clock times of ours.
  const part = opts.timeless ? null : sharedPart(picks);
  const route = planRoute({
    stops: picks.map((x) => ({ place: ctx.places.get(x.id)!, ...(typeof x.minutes === 'number' ? { minutes: x.minutes } : {}), ...(opts.labels && x.part ? { part: x.part } : {}) })),
    hotel: ctx.hotel ?? null,
    part,
  });
  if (opts.facts) {
    const day = part && isDay(picks[0]!.day) ? `${DAY_NAME[picks[0]!.day]} ${PART_LABEL[part]}` : null;
    const facts = [...(day ? [day] : []), ...routeFacts(route), `${picks.length} ${picks.length === 1 ? 'stop' : 'stops'}`];
    p.root.push(`${name}Facts`);
    p.lines.push(`${name}Facts = Summary(${list(facts.map(str))})`);
  }
  opts.between?.();
  // Each stop carries the way to it from the stop before: Stop(n, id, when, long, way, mode, note, day, part).
  const items = picks.map((x, i) => {
    const pl = ctx.places.get(x.id)!;
    const stop = route.stops[i]!;
    const leg = i > 0 ? route.legs[i - 1] : null;
    const when = stop.start !== null && stop.end !== null ? clockSpan(stop.start, stop.end) : opts.labels && x.part ? PART_LABEL[x.part][0]!.toUpperCase() + PART_LABEL[x.part].slice(1) : null;
    const args = [num(i + 1), str(x.id), opt(when), opt(aboutHowLong(stop.minutes)), opt(leg ? legLine(leg, pl.name) : null), opt(leg?.mode), opt(x.note), opt(x.day), opt(x.part)];
    while (args.length > 2 && args[args.length - 1] === 'null') args.pop();
    return `Stop(${args.join(', ')})`;
  });
  const first = ctx.places.get(picks[0]!.id)!;
  const from = route.fromHotel ? (route.fromHotel.mode === 'same' ? `${first.name} is in our hotel.` : `From our hotel: ${route.fromHotel.text[0]!.toLowerCase()}${route.fromHotel.text.slice(1)} to ${first.name}.`) : null;
  const back = opts.back && route.toHotel && route.toHotel.mode !== 'same' ? `Back to our hotel: ${route.toHotel.text[0]!.toLowerCase()}${route.toHotel.text.slice(1)}.` : null;
  if (!opts.inline) p.root.push(name);
  const modes = [opt(from ? route.fromHotel!.mode : null), opt(back ? route.toHotel!.mode : null)];
  p.lines.push(`${name} = Route(${[list(items), opt(from), opt(back), ...modes].join(', ').replace(/(, null)+$/, '')})`);
}

function picksProgram(plan: Plan, ctx: ComposeContext, route: boolean): string {
  const p = begin(plan);
  const all = knownPicks(plan, ctx);
  // An itinerary's own stops lead (map, route and cards); places from the wider list follow under their own heading.
  const lead = plan.itinerary?.stops ?? plan.route?.stops;
  const own = lead !== undefined ? all.filter((x) => plan.picks.findIndex((y) => y.id === x.id) < lead) : all;
  const picks = own.length ? own : all;
  const extras = all.filter((x) => !picks.includes(x));
  if (route && picks.length) {
    // The day's chips, then the map, then the stops in order with the way between them.
    routeLines(p, 'stops', picks, ctx, { facts: true, back: true, between: () => addMap(p, picks, ctx, true) });
  } else {
    addMap(p, picks, ctx, route);
    if (picks.length) {
      p.root.push('stops');
      p.lines.push(`stops = ${grid(picks)}`);
    }
  }
  if (extras.length) {
    p.root.push('more');
    const heading = plan.route && !plan.itinerary ? (LATER[extras.length] ?? 'More ideas') : (MORE[extras.length] ?? 'More from our list');
    p.lines.push(`more = Col([Title(${str(heading)}, "md"), ${grid(extras)}], 2)`);
  }
  return end(p, plan);
}

function budgetProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  // An itinerary's stop carries the couple's own minutes for it; anything else, the place's own.
  const minutesOf = (x: PlanPick) => (typeof x.minutes === 'number' && x.minutes > 0 ? x.minutes : ctx.places.get(x.id)?.minutes);
  const rows = knownPicks(plan, ctx).filter((x) => typeof minutesOf(x) === 'number');
  const have = Math.min(600, Math.max(15, Math.round((plan.minutes ?? 120) / 15) * 15));
  if (!rows.length) return end(p, plan);
  const timed = new Map(rows.map((r) => [r.id, { ...ctx.places.get(r.id)!, minutes: minutesOf(r)! }]));
  // An itinerary's stops start ticked (those that fit); otherwise the best rows that fit.
  const offered = plan.itinerary ? rows.slice(0, plan.itinerary.stops) : rows;
  const picked = fitIn(have, offered.map((r) => r.id), timed);
  // What fits, as a short run of stops, each with its own length (the couple's minutes for it where
  // they set them) and the way from the one before; what does not fit follows under its own heading.
  // Nothing here is ticked or dragged: the only thing to do with a place is add it to a time.
  const cards = rows.filter((r) => picked.includes(r.id));
  const rest = rows.filter((r) => !picked.includes(r.id));
  if (cards.length) routeLines(p, 'cards', cards.map((c) => ({ ...c, note: undefined, minutes: timed.get(c.id)!.minutes! })), ctx, { facts: true, back: false, timeless: true });
  if (rest.length) {
    p.root.push('more');
    p.lines.push(`more = Col([Title(${str(cards.length ? (LATER[rest.length] ?? 'More ideas') : 'Each of these takes longer')}, "md"), ${grid(rest, false)}], 2)`);
  }
  return end(p, plan);
}

function switchProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  const groups = (plan.groups ?? [])
    .map((g) => ({ label: typeof g.label === 'string' ? g.label : '', picks: (g.ids ?? []).filter((id) => ctx.places.has(id)).map((id) => plan.picks.find((x) => x.id === id) ?? { id }) }))
    .filter((g) => g.label && g.picks.length);
  if (groups.length < 2) {
    const picks = knownPicks(plan, ctx);
    if (picks.length) {
      p.root.push('stops');
      p.lines.push(`stops = ${grid(picks)}`);
    }
    return end(p, plan);
  }
  p.state.push(`$set = ${str(groups[0]!.label)}`);
  p.root.push('choose', 'picks');
  p.lines.push(`choose = SegmentedControl($set, ${list(groups.map((g) => str(g.label)))}, "Where to go")`);
  groups.forEach((g, i) => p.lines.push(`g${i} = ${grid(g.picks)}`));
  const pick = groups
    .slice(0, -1)
    .reduceRight((acc, g, i) => `$set == ${str(g.label)} ? g${i} : ${acc}`, `g${groups.length - 1}`);
  p.lines.push(`picks = ${pick}`);
  return end(p, plan);
}

function askProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  const q = plan.question;
  const options = (q?.options ?? []).filter((o) => o && typeof o.label === 'string' && o.label.trim()).slice(0, 4);
  if (q && q.text && options.length) {
    p.root.push('ask');
    p.lines.push(`ask = Choice(${str(q.text)}, ${list(options.map((o) => `Option(${str(o.label)}${o.note ? `, ${str(o.note)}` : ''})`))})`);
  }
  const picks = knownPicks(plan, ctx).slice(0, 2);
  if (picks.length) {
    p.root.push('stops');
    p.lines.push(`stops = ${grid(picks)}`);
  }
  return end(p, plan);
}

function weekendProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  // No cap: a weekend keeps every place the guest saved, and "Use this plan" applies all of them.
  const picks = knownPicks(plan, ctx, Infinity).filter((x) => isDay(x.day) && x.part && !(x.day === 'sat' && x.part !== 'morning'));
  for (const day of DAYS) {
    const mine = picks.filter((x) => x.day === day);
    if (!mine.length && day !== 'sat') continue;
    const parts: string[] = [`Title(${str(dateLabel(weekendDate(day)))}, "md")`];
    if (day === 'sat') {
      // The wedding's own events, by name, when the invitation carries them.
      const names = scheduleOf(ctx.events ?? []).filter((e) => e.dateIso === weekendDate('sat')).map((e) => e.name);
      parts.push(`Text(${str(names.length ? `The afternoon and evening are the wedding: ${names.join(', ')}.` : 'The afternoon and evening are the wedding.')}, "md", "muted")`);
    }
    if (mine.length) {
      // The day's places in the order of the day, each with how long it takes and the way to the next.
      const ordered = [...mine].sort((a, b) => PARTS.indexOf(a.part!) - PARTS.indexOf(b.part!));
      routeLines(p, `${day}Route`, ordered, ctx, { facts: false, back: false, labels: true, inline: true });
      parts.push(`${day}Route`);
    }
    p.root.push(day);
    p.lines.push(`${day} = Col(${list(parts)}, 2)`);
  }
  if (picks.length) {
    const items = picks.map((x) => `{id: ${str(x.id)}, day: ${str(x.day)}, part: ${str(x.part)}}`);
    p.root.push('use');
    p.lines.push(`use = Button("Put all of these in my plans", @SetWeekend(${list(items)}), "primary")`);
  }
  return end(p, plan);
}

function calendarProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  const days = (ctx.calendar ?? []).map((d) => {
    const events = d.entries.map((e) => `CalendarEvent(${str(e.title)}, ${opt(e.time)}, ${str(e.source)}${e.note ? `, ${str(e.note)}` : ''})`);
    return `CalendarDay(${str(d.label)}, ${str(d.date)}, ${list(events)})`;
  });
  p.root.push('cal');
  p.lines.push(`cal = Calendar(${list(days)})`);
  return end(p, plan);
}

/** The wedding's events in order, then the room block with its check-in and check-out days. */
function scheduleProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  const items = scheduleOf(ctx.events ?? []);
  if (items.length) {
    const rows = items.map((e) => `WeddingEvent(${[str(e.name), str(e.day), opt(e.time), opt(e.room), opt(e.dressCode), opt(e.accessibilityNote), opt(e.about), opt(e.note)].join(', ').replace(/(, null)+$/, '')})`);
    p.root.push('day');
    p.lines.push(`day = Schedule(${list(rows)})`);
  }
  if (!plan.brief) {
    p.root.push('stay');
    p.lines.push('stay = Stay(null, true)');
  }
  return end(p, plan);
}

/** The guest's own plan, and a button for each time it could go. */
function ownProgram(plan: Plan): string {
  const p = begin(plan);
  const own = plan.own;
  const slots = (own?.slots ?? []).filter((s) => isDay(s.day) && PARTS.includes(s.part) && !(s.day === 'sat' && s.part !== 'morning')).slice(0, 9);
  if (own && typeof own.title === 'string' && own.title.trim() && slots.length) {
    p.root.push('own');
    p.lines.push(`own = Col(${list(slots.map((s) => `OwnPlan(${str(own.title.trim().slice(0, 80))}, ${str(s.day)}, ${str(s.part)})`))}, 1)`);
  }
  return end(p, plan);
}

function simpleProgram(plan: Plan, block: 'stay' | 'arrive'): string {
  const p = begin(plan);
  p.root.push(block);
  p.lines.push(block === 'stay' ? 'stay = Stay()' : 'arrive = Arrive()');
  return end(p, plan);
}

export function compose(plan: Plan, ctx: ComposeContext): string {
  const safe: Plan = {
    ...plan,
    title: typeof plan?.title === 'string' ? plan.title : '',
    intro: typeof plan?.intro === 'string' ? plan.intro : '',
    picks: Array.isArray(plan?.picks) ? plan.picks : [],
    next: Array.isArray(plan?.next) ? plan.next : [],
  };
  switch (safe.shape) {
    case 'route':
      return picksProgram(safe, ctx, true);
    case 'budget':
      return budgetProgram(safe, ctx);
    case 'switch':
      return switchProgram(safe, ctx);
    case 'stay':
    case 'arrive':
      return simpleProgram(safe, safe.shape);
    case 'ask':
      return askProgram(safe, ctx);
    case 'weekend':
      return weekendProgram(safe, ctx);
    case 'calendar':
      return calendarProgram(safe, ctx);
    case 'schedule':
      return scheduleProgram(safe, ctx);
    case 'own':
      return ownProgram(safe);
    case 'picks':
    default:
      return picksProgram(safe, ctx, false);
  }
}

/** The places a plan shows, for the page's context (e.g. an echo of what was answered). */
export function placesIn(plan: Plan, places: ReadonlyMap<string, PlannerPlace>): PlannerPlace[] {
  return (plan.picks ?? []).map((p) => places.get(p.id)).filter((p): p is PlannerPlace => !!p);
}
