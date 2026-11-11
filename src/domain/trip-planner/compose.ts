import { fitIn } from './draft';
import { DAY_NAME, dateLabel, weekendDate } from './facts';
import { scheduleOf } from './schedule';
import { DAYS, type ComposeContext, type Day, type Part, type Plan, type PlanPick, type PlannerPlace } from './types';

/**
 * A plan as an OpenUI Lang program for the site's own component library (src/components/trip/openui).
 * Called again every time the writer streams a line, so it accepts any partial plan: missing text
 * becomes "", unknown place ids are left out, and every statement it writes is referenced from root.
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

function knownPicks(plan: Plan, ctx: ComposeContext): PlanPick[] {
  const seen = new Set<string>();
  return (plan.picks ?? []).filter((p) => p && typeof p.id === 'string' && ctx.places.has(p.id) && !seen.has(p.id) && seen.add(p.id)).slice(0, 6);
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
  p.root.push('map', 'picked');
  // Every stop, in the plan's order, so the map's numbers are the cards' order. A stop without
  // coordinates is listed under the map with its number but gets no pin.
  const markers = picks.map((x) => {
    const pl = ctx.places.get(x.id)!;
    const hasSpot = typeof pl.lat === 'number' && typeof pl.lng === 'number';
    return hasSpot ? `MapMarker(${str(pl.name)}, ${num(pl.lat!)}, ${num(pl.lng!)}, ${str(pl.id)})` : `MapMarker(${str(pl.name)}, null, null, ${str(pl.id)})`;
  });
  p.lines.push(`map = Map(${list(markers)}, ${route ? 'true' : 'false'}, $stop)`);
  p.lines.push(`picked = Caption($stop == "" ? "Tap a numbered pin to see which place it is." : "Pin: " + $stop)`);
}

function slotLabel(pick: PlanPick | undefined): string | null {
  if (!pick || !isDay(pick.day) || !pick.part) return null;
  return `${DAY_NAME[pick.day]} ${PART_LABEL[pick.part]}`;
}

const MORE = ['', 'One more from our list', 'Two more from our list', 'Three more from our list'];

function picksProgram(plan: Plan, ctx: ComposeContext, route: boolean): string {
  const p = begin(plan);
  const all = knownPicks(plan, ctx);
  // An itinerary's own stops lead (map, route and cards); places from the wider list follow under their own heading.
  const own = plan.itinerary ? all.filter((x) => plan.picks.findIndex((y) => y.id === x.id) < plan.itinerary!.stops) : all;
  const picks = own.length ? own : all;
  const extras = all.filter((x) => !picks.includes(x));
  if (route && picks.length) {
    const when = slotLabel(picks[0]);
    const badges = [when ? `Badge(${str(when)}, "neutral")` : null, `Badge(${str(`${picks.length} ${picks.length === 1 ? 'stop' : 'stops'}`)}, "info")`].filter(Boolean) as string[];
    p.root.push('facts');
    p.lines.push(`facts = Row(${list(badges)}, 2, true)`);
  }
  addMap(p, picks, ctx, route);
  if (picks.length) {
    p.root.push('stops');
    p.lines.push(`stops = ${grid(picks)}`);
  }
  if (extras.length) {
    p.root.push('more');
    p.lines.push(`more = Col([Title(${str(MORE[extras.length] ?? 'More from our list')}, "md"), ${grid(extras)}], 2)`);
  }
  return end(p, plan);
}

function budgetProgram(plan: Plan, ctx: ComposeContext): string {
  const p = begin(plan);
  // An itinerary's stop carries the couple's own minutes for it; anything else, the place's own.
  const minutesOf = (x: PlanPick) => (typeof x.minutes === 'number' && x.minutes > 0 ? x.minutes : ctx.places.get(x.id)?.minutes);
  const rows = knownPicks(plan, ctx).filter((x) => typeof minutesOf(x) === 'number');
  const have = Math.min(600, Math.max(15, Math.round((plan.minutes ?? 120) / 15) * 15));
  const max = Math.max(240, Math.ceil(have / 60) * 60);
  if (!rows.length) return end(p, plan);
  const timed = new Map(rows.map((r) => [r.id, { ...ctx.places.get(r.id)!, minutes: minutesOf(r)! }]));
  // An itinerary's stops start ticked (those that fit); otherwise the best rows that fit.
  const offered = plan.itinerary ? rows.slice(0, plan.itinerary.stops) : rows;
  const picked = fitIn(have, offered.map((r) => r.id), timed);
  p.state.push(`$have = ${have}`, `$picked = ${list(picked.map(str))}`);
  p.root.push('tool');
  const all = rows.map((r) => {
    const pl = timed.get(r.id)!;
    return `{id: ${str(pl.id)}, name: ${str(pl.name)}, min: ${num(pl.minutes!)}}`;
  });
  p.lines.push(
    `all = ${list(all)}`,
    'used = @Sum(@Each(all, "p", @Includes($picked, p.id) ? p.min : 0))',
    'rows = Col(@Each(all, "p", Pressable([Row([Text(p.name, "md", null, "medium"), Spacer(), Caption("about " + p.min + " min")], 2)], @Set($picked, @Toggle($picked, p.id)), @Includes($picked, p.id))), 1)',
    'total = Row([Text("Planned: " + used + " of " + $have + " min", "md", null, "semibold"), Spacer(), Badge(used <= $have ? "Fits" : "Over by " + (used - $have) + " min", used <= $have ? "success" : "warning")], 2)',
    `tool = Card([Slider($have, 15, ${max}, 15, "Time you have", " min"), rows, total], "soft")`,
  );
  const cards = rows.filter((r) => picked.includes(r.id));
  if (cards.length) {
    p.root.push('cards');
    p.lines.push(`cards = ${grid(cards, false)}`);
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
  const picks = knownPicks(plan, ctx).filter((x) => isDay(x.day) && x.part && !(x.day === 'sat' && x.part !== 'morning'));
  for (const day of DAYS) {
    const mine = picks.filter((x) => x.day === day);
    if (!mine.length && day !== 'sat') continue;
    const parts: string[] = [`Title(${str(dateLabel(weekendDate(day)))}, "md")`];
    if (day === 'sat') {
      // The wedding's own events, by name, when the invitation carries them.
      const names = scheduleOf(ctx.events ?? []).filter((e) => e.dateIso === weekendDate('sat')).map((e) => e.name);
      parts.push(`Text(${str(names.length ? `The afternoon and evening are the wedding: ${names.join(', ')}.` : 'The afternoon and evening are the wedding.')}, "md", "muted")`);
    }
    if (mine.length) parts.push(grid(mine));
    p.root.push(day);
    p.lines.push(`${day} = Col(${list(parts)}, 2)`);
  }
  if (picks.length) {
    const items = picks.map((x) => `{id: ${str(x.id)}, day: ${str(x.day)}, part: ${str(x.part)}}`);
    const buttons = [`Button("Use this plan", @SetWeekend(${list(items)}), "primary")`];
    if (ctx.saved.length >= 3) buttons.push('Button("My weekend is set", @ConfirmWeekend(), "secondary")');
    p.root.push('use');
    p.lines.push(`use = Row(${list(buttons)}, 2, true)`);
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
  p.root.push('stay');
  p.lines.push('stay = Stay(null, true)');
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
    case 'picks':
    default:
      return picksProgram(safe, ctx, false);
  }
}

/** The places a plan shows, for the page's context (e.g. an echo of what was answered). */
export function placesIn(plan: Plan, places: ReadonlyMap<string, PlannerPlace>): PlannerPlace[] {
  return (plan.picks ?? []).map((p) => places.get(p.id)).filter((p): p is PlannerPlace => !!p);
}
