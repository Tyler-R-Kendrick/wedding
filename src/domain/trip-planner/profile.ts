import { understand } from './intent';
import { DIETS, MEALS, PRICE_LEVELS, type Diet, type Meal, type PriceLevel, type Theme } from './types';

/**
 * Who the planner is planning for. A profile is put together, each time the page loads, from two
 * things and nothing else: what the site's own records say about this guest's party (who is in the
 * household, what they told us at RSVP), and what the guest has set for themselves here. Nothing is
 * looked up about a guest anywhere else, and nothing is guessed from a name or an address.
 *
 * Everything in it is shown to the guest ("Planning for…") and is theirs to change.
 */

/** Kinds of thing a guest can say they enjoy, each one a theme the planner already ranks by. */
export const INTERESTS = ['coffee', 'food', 'drinks', 'architecture', 'museum', 'outdoors', 'view', 'play'] as const satisfies readonly Theme[];
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LABEL: Record<Interest, string> = {
  coffee: 'Coffee',
  food: 'Good food',
  drinks: 'Cocktails',
  architecture: 'Architecture',
  museum: 'Museums',
  outdoors: 'Parks and walks',
  view: 'Views',
  play: 'Games',
};

/**
 * What the guest set for themselves. Saved with their guest record, so it follows them to another
 * device. `null` means they have not said (the RSVP then fills in); an empty list or `false` is an
 * answer ("nothing", "no") and stands.
 */
export type TripPrefs = {
  diet: Diet[] | null;
  meal: Meal | null;
  /** The most one person wants to spend at a meal. Null: no limit. */
  budget: PriceLevel | null;
  stepFree: boolean | null;
  shortWalks: boolean | null;
  interests: Interest[];
  /** Whether children come along. Null: as the household says. */
  kids: boolean | null;
  /** They have answered the planner's questions about meals. */
  asked: boolean;
};

export const NO_PREFS: TripPrefs = { diet: null, meal: null, budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: false };

/** What the site's own records say about the guest's party. */
export type TripRecords = {
  /** People on the invitation who have not said no: grown-ups and children. */
  adults: number;
  children: number;
  /** What the party told us at RSVP about food, in their words. Read here, never shown back as text. */
  dietary: string | null;
  accessibility: string | null;
};

/** Where a part of the profile came from, so the page can say so. */
export type ProfileSource = 'rsvp' | 'you';

export type TripProfile = {
  party: { adults: number; children: number };
  /** Children come along on outings. */
  kids: boolean;
  diet: Diet[];
  /** A food allergy they told us of at RSVP. No kitchen is vouched for on it, and the planner says so. */
  allergy: string | null;
  meal: Meal | null;
  budget: PriceLevel | null;
  stepFree: boolean;
  shortWalks: boolean;
  interests: Interest[];
  /** The meal questions are answered (here, or because the RSVP already says what they eat). */
  asked: boolean;
  from: { diet: ProfileSource | null; stepFree: ProfileSource | null; kids: ProfileSource | null };
  /** Whether the guest has set anything of their own. */
  saved: boolean;
};

const isOneOf = <T extends string | number>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/**
 * Stored preferences as the planner reads them. What is stored was validated when it was saved, but
 * it is JSON written by an earlier version of the site too, so every field is read tolerantly: an
 * unknown value is dropped, never trusted.
 */
export function readPrefs(stored: unknown): TripPrefs {
  if (!stored || typeof stored !== 'object') return { ...NO_PREFS };
  const s = stored as Record<string, unknown>;
  const list = <T extends string>(v: unknown, of: readonly T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => isOneOf(of, x)))] : []);
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : null);
  return {
    diet: Array.isArray(s.diet) ? list(s.diet, DIETS) : null,
    meal: isOneOf(MEALS, s.meal) ? s.meal : null,
    budget: isOneOf(PRICE_LEVELS, s.budget) ? s.budget : null,
    stepFree: flag(s.stepFree),
    shortWalks: flag(s.shortWalks),
    interests: list(s.interests, INTERESTS),
    kids: flag(s.kids),
    asked: s.asked === true,
  };
}

/** Whether preferences say anything at all (an empty set is not worth a row). */
export function hasPrefs(p: TripPrefs): boolean {
  return p.diet !== null || p.meal !== null || p.budget !== null || p.stepFree !== null || p.shortWalks !== null || p.interests.length > 0 || p.kids !== null || p.asked;
}

/** What an RSVP's free-text needs say, in the planner's own terms. The words themselves go no further. */
export function readNeeds(dietary: string | null | undefined, accessibility: string | null | undefined): { diet: Diet[]; allergy: string | null; stepFree: boolean; shortWalks: boolean; nothing: boolean } {
  const food = dietary?.trim() ? understand(dietary) : null;
  const access = accessibility?.trim() ? accessibility.toLowerCase() : '';
  return {
    diet: food?.diet ?? [],
    allergy: food?.allergy ?? null,
    stepFree: /\b(wheelchair|step[- ]free|no (stairs|steps)|can(no|'?)t (do|manage|climb|use) (stairs|steps)|stairs are|ramp|elevator|lift|scooter|walker|rollator|mobility|buggy|buggies|stroller|pram|pushchair)\b/.test(access),
    // "None", "no restrictions": an answer, so the question is not put to them again.
    nothing: !!dietary?.trim() && !food?.diet.length && !food?.allergy && (food?.noDiet === true || /^\W*(none|no|nope|nothing|n\/?a|not applicable|no thanks?|none for us)\W*$/i.test(dietary)),
    shortWalks: /\b(can(no|'?)t walk (far|long)|short (walks?|distances?)|limited mobility|tires? easily|walking is (hard|difficult)|cane|walker|rollator|bad (knee|hip|back)s?)\b/.test(access),
  };
}

/**
 * The profile: for each thing, the guest's own answer where they have given one (an answer of
 * "nothing" included, so a box they unticked stays unticked), and otherwise what the RSVP says.
 */
export function profileOf(records: TripRecords | null, prefs: TripPrefs | null): TripProfile {
  const mine = prefs ?? NO_PREFS;
  const adults = Math.max(1, records?.adults ?? 1);
  const children = Math.max(0, records?.children ?? 0);
  const needs = readNeeds(records?.dietary, records?.accessibility);
  const diet = mine.diet ?? needs.diet;
  const stepFree = mine.stepFree ?? needs.stepFree;
  const shortWalks = mine.shortWalks ?? needs.shortWalks;
  const kids = mine.kids ?? children > 0;
  return {
    party: { adults, children },
    kids,
    diet,
    allergy: needs.allergy,
    meal: mine.meal,
    budget: mine.budget,
    stepFree,
    shortWalks,
    interests: mine.interests,
    // What they eat is known already when the RSVP says it ("none" too): the question is not put to them again.
    asked: mine.asked || mine.diet !== null || diet.length > 0 || needs.nothing,
    from: {
      diet: !diet.length ? null : mine.diet !== null ? 'you' : 'rsvp',
      stepFree: !stepFree ? null : mine.stepFree !== null ? 'you' : 'rsvp',
      kids: mine.kids !== null ? 'you' : children > 0 ? 'rsvp' : null,
    },
    saved: prefs !== null && hasPrefs(prefs),
  };
}

/**
 * The profile as preferences to save: every answer as it stands now, whoever gave it, marked as the
 * guest's own. A change starts from this, so saving one answer never drops another.
 */
export function prefsOf(p: TripProfile): TripPrefs {
  return { diet: p.diet, meal: p.meal, budget: p.budget, stepFree: p.stepFree, shortWalks: p.shortWalks, interests: p.interests, kids: p.from.kids === 'you' ? p.kids : null, asked: true };
}

/** The profile after the guest saves `prefs`, before the server answers: the same party, their answers. */
export function withPrefs(p: TripProfile, prefs: TripPrefs): TripProfile {
  return {
    ...p,
    kids: prefs.kids ?? p.party.children > 0,
    diet: prefs.diet ?? p.diet,
    meal: prefs.meal,
    budget: prefs.budget,
    stepFree: prefs.stepFree ?? p.stepFree,
    shortWalks: prefs.shortWalks ?? p.shortWalks,
    interests: prefs.interests,
    asked: true,
    from: { diet: prefs.diet?.length ? 'you' : prefs.diet ? null : p.from.diet, stepFree: prefs.stepFree ? 'you' : prefs.stepFree === false ? null : p.from.stepFree, kids: prefs.kids !== null ? 'you' : p.party.children > 0 ? 'rsvp' : null },
    saved: true,
  };
}

const DIET_LABEL: Record<Diet, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-free', halal: 'Halal', kosher: 'Kosher' };
export const dietLabel = (d: Diet) => DIET_LABEL[d];
export const PRICE_SYMBOL: Record<PriceLevel, string> = { 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' };
/** A spending limit in words a guest would say. */
export const BUDGET_LABEL: Record<PriceLevel, string> = { 1: 'Under $15 each', 2: 'Up to $40 each', 3: 'Up to $100 each', 4: 'No limit' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Who is travelling, in a few words: "2 adults and 1 child", "Just you". */
export function partyWords(p: TripProfile): string {
  const kids = p.kids && p.party.children > 0 ? count(p.party.children, 'child', 'children') : null;
  if (p.party.adults === 1 && !kids) return 'Just you';
  const grown = count(p.party.adults, 'adult', 'adults');
  return kids ? `${grown} and ${kids}` : grown;
}

/**
 * The profile as the short list the page shows above the planner: who, then only what narrows the
 * answers. Each entry says what it is; `from` marks one that came from the RSVP.
 */
export function profileSummary(p: TripProfile): { key: string; text: string; from?: ProfileSource }[] {
  const out: { key: string; text: string; from?: ProfileSource }[] = [{ key: 'party', text: partyWords(p) }];
  if (p.kids && p.party.children === 0) out.push({ key: 'kids', text: 'With children' });
  if (p.diet.length) out.push({ key: 'diet', text: p.diet.map(dietLabel).join(', '), ...(p.from.diet === 'rsvp' ? { from: 'rsvp' as const } : {}) });
  if (p.allergy) out.push({ key: 'allergy', text: p.allergy === 'food' ? 'A food allergy' : `${p.allergy.charAt(0).toUpperCase()}${p.allergy.slice(1)} allergy`, from: 'rsvp' });
  if (p.budget && p.budget < 4) out.push({ key: 'budget', text: `${BUDGET_LABEL[p.budget]} for a meal` });
  if (p.stepFree) out.push({ key: 'stepFree', text: 'Step-free places', ...(p.from.stepFree === 'rsvp' ? { from: 'rsvp' as const } : {}) });
  if (p.shortWalks) out.push({ key: 'shortWalks', text: 'Close to the hotel' });
  if (p.interests.length) out.push({ key: 'interests', text: p.interests.map((i) => INTEREST_LABEL[i]).join(', ') });
  return out;
}

/**
 * First suggestions that fit this guest, in their own voice, before the general ones. Only what the
 * profile gives reason for; a guest we know nothing more about gets none.
 */
export function profileStarters(p: TripProfile): string[] {
  const out: string[] = [];
  if (p.kids) out.push('A morning out with the kids');
  if (p.diet.length) out.push(`${dietLabel(p.diet[0]!)} dinner near the hotel`);
  if (p.stepFree) out.push('Step-free things to do nearby');
  else if (p.shortWalks) out.push('Things to do close to the hotel');
  const like = p.interests.find((i) => i !== 'food');
  if (like) out.push({ coffee: 'Great coffee nearby', drinks: 'Cocktails on Friday evening', architecture: 'An afternoon of architecture', museum: 'A museum for Sunday morning', outdoors: 'A walk in the park', view: 'The best views in town', play: 'Somewhere to play games' }[like]);
  if (p.budget && p.budget <= 2) out.push('Good food that is not expensive');
  return out.slice(0, 3);
}
