/**
 * What the evals measure: one guest request (with what they have saved and said about themselves),
 * answered by the planner exactly as the page answers it, and read back as plain data.
 *
 * The planner is the site's own code (src/domain/trip-planner). The places are the couple's own
 * recommendations from the seed; the outside search is the recorded sample of real results near
 * the hotel (src/providers/place-search/fixture.json), so a run never touches the network.
 */
import * as planner from '@/domain/trip-planner';
import type { Plan, PlannerItinerary, PlannerPlace, SavedItem, WeddingEventInput } from '@/domain/trip-planner';
import recommendations from '@/content/seed/recommendations.json';
import placesSeed from '@/content/seed/places.json';
import itinerariesSeed from '@/content/seed/itineraries.json';
import outsideFixture from '@/providers/place-search/fixture.json';

type Rec = { slug: string; title: string; category: string; interests?: string[]; placeSlug?: string; what?: string; durationMinutes?: number; whyWeShareThis?: string; draft?: boolean; placeholder?: boolean; kidFriendly?: boolean };
type Spot = { slug: string; kind?: string; address?: string; lat?: number; lng?: number };

const spots = new Map((placesSeed as Spot[]).map((p) => [p.slug, p]));

/** The couple's live recommendations, as the page hands them to the planner (planner-data.ts). */
export const PLACES: PlannerPlace[] = (recommendations as Rec[])
  .filter((r) => !r.draft && !r.placeholder && r.what && !/TODO\(/.test(r.what))
  .map((r) => {
    const at = r.placeSlug ? spots.get(r.placeSlug) : undefined;
    const why = r.whyWeShareThis && !/TODO\(/.test(r.whyWeShareThis) ? r.whyWeShareThis : undefined;
    return {
      id: r.slug,
      slug: r.slug,
      name: r.title,
      category: r.category,
      interests: r.interests ?? [],
      what: r.what!,
      ...(why ? { why } : {}),
      ...(r.durationMinutes ? { minutes: r.durationMinutes } : {}),
      ...(typeof r.kidFriendly === 'boolean' ? { kidFriendly: r.kidFriendly } : {}),
      ...(at?.address ? { address: at.address } : {}),
      ...(typeof at?.lat === 'number' && typeof at?.lng === 'number' ? { lat: at.lat, lng: at.lng } : {}),
      href: `/guests/things-to-do/${r.slug}`,
    };
  });
const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

type SeedItinerary = { slug: string; title: string; intro?: string; bucket: string; minMinutes?: number; maxMinutes?: number; interests?: string[]; stops: { recommendationSlug: string; minutes?: number }[]; draft?: boolean };
const ITINERARIES: PlannerItinerary[] = (itinerariesSeed as SeedItinerary[])
  .filter((i) => !i.draft)
  .map((i) => ({ slug: i.slug, title: i.title, intro: i.intro ?? '', bucket: i.bucket, minMinutes: i.minMinutes, maxMinutes: i.maxMinutes, interests: i.interests ?? [], stops: i.stops.filter((s) => BY_ID.has(s.recommendationSlug)).map((s) => ({ placeId: s.recommendationSlug, ...(s.minutes ? { minutes: s.minutes } : {}) })) }));

const SAT = planner.weekendDate('sat');
const EVENTS: Record<string, WeddingEventInput[]> = {
  unset: [
    { id: 'ev-c', name: 'Ceremony', dateIso: SAT, startsAt: null, endsAt: null },
    { id: 'ev-r', name: 'Reception', dateIso: SAT, startsAt: null, endsAt: null },
  ],
  set: [
    { id: 'ev-c', name: 'Ceremony', dateIso: SAT, startsAt: `${SAT}T21:30:00.000Z`, endsAt: `${SAT}T22:00:00.000Z`, room: 'Garden Room', dressCode: 'Garden formal' },
    { id: 'ev-r', name: 'Reception', dateIso: SAT, startsAt: `${SAT}T23:30:00.000Z`, endsAt: null, room: 'Ballroom', dressCode: 'Garden formal' },
  ],
};

export type Scenario = {
  request: string;
  saved?: SavedItem[];
  /** What the guest has already told the planner about themselves in this visit. */
  prefs?: { diet?: string[]; meal?: string | null; asked?: boolean };
  /** Their answers to a clarifying question, if the planner asks one: the request is then answered with them. */
  answers?: { diet?: string[]; meal?: string | null };
  events?: 'set' | 'unset';
};

export type Answer = {
  shape: string;
  title: string;
  intro: string;
  clarifies: boolean;
  asksAbout: string[];
  ours: { id: string; name: string; category: string; kidFriendly: boolean; inHotel: boolean; day?: string; part?: string }[];
  outside: { name: string; kind: string; cuisine: string[]; diet: string[]; meters: number }[];
  own: { title: string; slots: [string, string][] } | null;
  next: string[];
  text: string;
  turns: number;
};

// The parts of the planner that came after the first baseline; a run against an older planner does without them.
const p = planner as unknown as Record<string, (...args: never[]) => unknown>;
const has = (name: string) => typeof p[name] === 'function';
const hotel = { name: 'Our hotel', ...(outsideFixture as { near: { lat: number; lng: number } }).near };

function once(s: Scenario, prefs: Scenario['prefs']): { plan: Plan; outside: Answer['outside']; program: string } {
  const saved = s.saved ?? [];
  const events = EVENTS[s.events ?? 'unset']!;
  const plan = planner.draftPlan({ request: s.request, places: PLACES, saved, itineraries: ITINERARIES, events, ...(prefs ? ({ prefs } as object) : {}) } as Parameters<typeof planner.draftPlan>[0]);
  let found: unknown[] = [];
  const query = (plan as unknown as { outside?: unknown }).outside;
  if (query && has('pickOutside')) found = p.pickOutside!(...([query, (outsideFixture as { places: unknown[] }).places, PLACES, hotel] as never[])) as unknown[];
  const outside = (found as { name: string; kind: string; cuisine: string[]; diet: string[]; meters: number }[]).map((o) => ({ name: o.name, kind: o.kind, cuisine: o.cuisine, diet: o.diet, meters: Math.round(o.meters) }));
  // Searched (the planner asked for it and can choose from what was found): what it chose is shown, even when that is nothing.
  const searched = !!query && has('pickOutside');
  // The guest's plans as the page reads them: the wedding's events with what they have saved.
  const calendar = plan.shape === 'calendar' ? planner.calendarModel([...planner.weddingEntries(events), ...planner.planEntries(saved, BY_ID)]) : undefined;
  const program = planner.compose(plan, { places: BY_ID, saved, events, hotel, ...(calendar ? { calendar } : {}), ...(searched ? ({ outside: found } as object) : {}) } as Parameters<typeof planner.compose>[1]);
  return { plan, outside, program };
}

export function answer(s: Scenario): Answer {
  let prefs = s.prefs;
  let { plan, outside, program } = once(s, prefs);
  let turns = 1;
  const clarify = (plan as unknown as { clarify?: { groups: { id: string }[] } }).clarify;
  const first = { clarifies: plan.shape === 'clarify', asksAbout: clarify?.groups.map((g) => g.id) ?? [] };
  // The guest answers the question: the same request, now with what they said.
  if (first.clarifies && s.answers) {
    prefs = { diet: s.answers.diet ?? [], meal: s.answers.meal ?? null, asked: true };
    ({ plan, outside, program } = once(s, prefs));
    turns = 2;
  }
  const picks = (plan.picks ?? []).filter((x) => BY_ID.has(x.id));
  const own = (plan as unknown as { own?: { title: string; slots: { day: string; part: string }[] } }).own;
  const strings = [...program.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
  return {
    shape: plan.shape,
    title: plan.title,
    intro: plan.intro,
    clarifies: s.answers ? first.clarifies : plan.shape === 'clarify',
    asksAbout: first.asksAbout,
    ours: picks.map((x) => {
      const pl = BY_ID.get(x.id)!;
      return { id: pl.id, name: pl.name, category: pl.category, kidFriendly: pl.kidFriendly === true || pl.category === 'with-kids' || pl.interests.includes('kids'), inHotel: pl.interests.includes('inside-caa'), ...(x.day ? { day: x.day } : {}), ...(x.part ? { part: x.part } : {}) };
    }),
    outside,
    own: own ? { title: own.title, slots: own.slots.map((x) => [x.day, x.part]) } : null,
    next: plan.next ?? [],
    // Every word the guest would read in the answer (the program's own strings).
    text: strings.join(' \n '),
    turns,
  };
}
