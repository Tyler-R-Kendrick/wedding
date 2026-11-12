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
  from: { diet: ProfileSource | null; stepFree: ProfileSource | null; shortWalks: ProfileSource | null; kids: ProfileSource | null };
  /** Which of these the guest answered themselves, "nothing" and "no" included. The rest follow the RSVP, today's and any later one. */
  own: { diet: boolean; stepFree: boolean; shortWalks: boolean };
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

// A note that says something is NOT so ("not vegetarian", "no allergies", "wheelchair not needed",
// "Allergies: none") must never be read as its opposite. These are taken out before a note is read.
// The "no" may come before the word or after it; it never reaches past an "and" or a "but", so the
// rest of the note is still read ("not vegan but vegetarian", "no gluten and allergic to shellfish").
const GAP = String.raw`(?:(?!\b(?:and|but|though|however|just|only)\b)[^.,;:()\n])`;
const NO_WORD = String.raw`\b(?:no|not|non|none|never|without|zero|\w+n't)\b`;
// At the end of what it is said about: "Vegetarian: no", "wheelchair - none".
const TRAILING_NO = String.raw`\s*[:=–-]?\s*(?:(?:no|none|nope|nil|n\/?a|nothing)\b\s*(?=$|[.,;)\n])|(?:is |are )?(?:not|never) (?:needed|required|necessary|applicable|relevant|an issue|a problem)\b|unnecessary\b)`;
const DIET_TERM = String.raw`(?:veg\w*|halal|kosher|gluten[- ]free|gf|c[eo]?eliac)`;
const NEED_TERM = String.raw`(?:mobility|wheelchairs?|ramps?|elevators?|lifts?|scooters?|walkers?|rollators?|step[- ]free|access\w*|canes?|strollers?|bugg(?:y|ies)|prams?|pushchairs?|assistance|help)`;
const NOT_A_DIET = new RegExp(String.raw`${NO_WORD}${GAP}{0,14}?\b${DIET_TERM}\b|\bnon[- ]?veg\w*|\b${DIET_TERM}\b${TRAILING_NO}`, 'gi');
const NOT_AN_ALLERGY = new RegExp(String.raw`${NO_WORD}${GAP}{0,24}?\ballerg\w*|\ballerg\w*${TRAILING_NO}|\ballergic to (?:nothing|none)\b`, 'gi');
const NOT_A_NEED = new RegExp(String.raw`${NO_WORD}${GAP}{0,28}?\b${NEED_TERM}\b|\b${NEED_TERM}\b(?: access| use)?${TRAILING_NO}`, 'gi');
// Said with a "no" or a "cannot", and a need all the same.
const NO_STAIRS = /\b(no (stairs|steps)|(can(no|'?)t|unable to|not able to|do(es)? not|don'?t|doesn'?t) (do|manage|climb|use|take) (the |any )?(stairs|steps)|(stairs|steps) are (hard|difficult|a problem|not possible))\b/i;
const CANNOT_WALK_FAR = /\b((can(no|'?)t|unable to|not able to|do(es)? not|don'?t|doesn'?t) walk (very |too )?(far|long|well|much)|walking is (hard|difficult|painful))\b/i;
// What they do not eat, said as a "no": the diet it amounts to.
const NO_GLUTEN = /\b(no|can(no|'?)t (eat|have)|do(es)? not eat|don'?t eat|doesn'?t eat|avoids?|avoiding) (gluten|wheat)\b/i;
const NO_MEAT = /\b(no|do(es)? not eat|don'?t eat|doesn'?t eat) meat\b/i;
const STEP_FREE = /\b(wheelchairs?|step[- ]free|ramps?|elevators?|lifts?|scooters?|walkers?|rollators?|mobility (aid|issues?|problems?|needs?)|limited mobility|bugg(y|ies)|strollers?|prams?|pushchairs?)\b/i;
const SHORT_WALKS = /\b(short (walks?|distances?)|limited mobility|mobility (issues?|problems?)|tires? easily|canes?|walkers?|rollators?|bad (knee|hip|back)s?)\b/i;
/** A phone's curly apostrophe is the same apostrophe. */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[‘’ʼ]/g, "'").trim();

/**
 * What an RSVP's free-text needs say, in the planner's own terms. The words themselves go no
 * further. A note is read for what it affirms: what it says is not needed is left out first, so
 * "no mobility issues" asks for nothing and "not vegetarian" is not a diet.
 */
export function readNeeds(dietary: string | null | undefined, accessibility: string | null | undefined): { diet: Diet[]; allergy: string | null; stepFree: boolean; shortWalks: boolean; nothing: boolean } {
  const said = plain(dietary);
  const food = said ? understand(said.replace(NOT_A_DIET, ' ').replace(NOT_AN_ALLERGY, ' ')) : null;
  const diet = new Set<Diet>(food?.diet ?? []);
  if (NO_GLUTEN.test(said)) diet.add('gluten-free');
  if (NO_MEAT.test(said)) diet.add('vegetarian');
  const access = plain(accessibility);
  const needs = access.replace(NOT_A_NEED, ' ');
  return {
    diet: [...diet],
    allergy: food?.allergy ?? null,
    stepFree: NO_STAIRS.test(access) || STEP_FREE.test(needs),
    // "None", "no restrictions": an answer, so the question is not put to them again.
    nothing: !!said && !diet.size && !food?.allergy && (understand(said).noDiet || /^\W*(none|no|nope|nothing|n\/?a|not applicable|no thanks?|none for us)\W*$/i.test(said)),
    shortWalks: CANNOT_WALK_FAR.test(access) || SHORT_WALKS.test(needs),
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
      shortWalks: !shortWalks ? null : mine.shortWalks !== null ? 'you' : 'rsvp',
      kids: mine.kids !== null ? 'you' : children > 0 ? 'rsvp' : null,
    },
    own: { diet: mine.diet !== null, stepFree: mine.stepFree !== null, shortWalks: mine.shortWalks !== null },
    saved: prefs !== null && hasPrefs(prefs),
  };
}

/** What the page shows for each answer, whoever gave it: where a change to the profile starts from. */
export type TripAnswers = { diet: Diet[]; meal: Meal | null; budget: PriceLevel | null; stepFree: boolean; shortWalks: boolean; interests: Interest[]; kids: boolean };
export const answersOf = (p: TripProfile): TripAnswers => ({ diet: p.diet, meal: p.meal, budget: p.budget, stepFree: p.stepFree, shortWalks: p.shortWalks, interests: p.interests, kids: p.kids });

const sameList = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The answers as preferences to save. What the guest eats, and the two access answers, are kept as
 * their own only where they already were or where the guest changed them: an answer that merely
 * repeats what the RSVP says (or says nothing, as the RSVP does) is left to the RSVP, so a need
 * told to us there later is not shut out by an earlier save that never mentioned it, and what a
 * household member told us at RSVP is not copied into this guest's own record.
 */
export function ownAnswers(p: TripProfile, said: TripAnswers): TripPrefs {
  return {
    diet: !p.own.diet && sameList(said.diet, p.diet) ? null : said.diet,
    meal: said.meal,
    budget: said.budget,
    stepFree: !p.own.stepFree && said.stepFree === p.stepFree ? null : said.stepFree,
    shortWalks: !p.own.shortWalks && said.shortWalks === p.shortWalks ? null : said.shortWalks,
    interests: said.interests,
    // "Children come along" is saved only when it differs from what the invitation says.
    kids: said.kids === p.party.children > 0 ? null : said.kids,
    asked: true,
  };
}

/** The profile as the preferences that would give it again: the guest's own answers, and nothing the RSVP supplied. */
export function prefsOf(p: TripProfile): TripPrefs {
  return { diet: p.own.diet ? p.diet : null, meal: p.meal, budget: p.budget, stepFree: p.own.stepFree ? p.stepFree : null, shortWalks: p.own.shortWalks ? p.shortWalks : null, interests: p.interests, kids: p.from.kids === 'you' ? p.kids : null, asked: true };
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
    from: { diet: prefs.diet?.length ? 'you' : prefs.diet ? null : p.from.diet, stepFree: prefs.stepFree ? 'you' : prefs.stepFree === false ? null : p.from.stepFree, shortWalks: prefs.shortWalks ? 'you' : prefs.shortWalks === false ? null : p.from.shortWalks, kids: prefs.kids !== null ? 'you' : p.party.children > 0 ? 'rsvp' : null },
    own: { diet: prefs.diet !== null, stepFree: prefs.stepFree !== null, shortWalks: prefs.shortWalks !== null },
    saved: true,
  };
}

const DIET_LABEL: Record<Diet, string> = { vegetarian: 'Vegetarian', vegan: 'Vegan', 'gluten-free': 'Gluten-free', halal: 'Halal', kosher: 'Kosher' };
export const dietLabel = (d: Diet) => DIET_LABEL[d];
export const PRICE_SYMBOL: Record<PriceLevel, string> = { 1: '$', 2: '$$', 3: '$$$', 4: '$$$$' };
/** A spending limit in words a guest would say. */
export const BUDGET_LABEL: Record<PriceLevel, string> = { 1: 'Under $15 each', 2: 'Up to $40 each', 3: 'Up to $100 each', 4: 'No limit' };

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Who is travelling, in a few words: "2 adults and 1 child", "Just you", "You, with children". */
export function partyWords(p: TripProfile): string {
  const grown = count(p.party.adults, 'adult', 'adults');
  if (p.kids && p.party.children > 0) return `${grown} and ${count(p.party.children, 'child', 'children')}`;
  // Children they said come along, though none is on the invitation: said, without a number we do not have.
  if (p.kids) return p.party.adults === 1 ? 'You, with children' : `${grown}, with children`;
  return p.party.adults === 1 ? 'Just you' : grown;
}

/**
 * The profile as the one sentence the page shows above the planner: who (the first entry), then
 * only what narrows the answers, each in a few plain words. `from` marks what came from the RSVP.
 * What they enjoy is two things and a count, never a list that runs to a paragraph.
 */
export function profileSummary(p: TripProfile): { key: string; text: string; from?: ProfileSource }[] {
  const out: { key: string; text: string; from?: ProfileSource }[] = [{ key: 'party', text: partyWords(p) }];
  const rsvp = (source: ProfileSource | null) => (source === 'rsvp' ? { from: 'rsvp' as const } : {});
  if (p.diet.length) out.push({ key: 'diet', text: p.diet.map((d) => dietLabel(d).toLowerCase()).join(' and '), ...rsvp(p.from.diet) });
  if (p.allergy) out.push({ key: 'allergy', text: p.allergy === 'food' ? 'a food allergy' : `a ${p.allergy} allergy`, from: 'rsvp' });
  if (p.budget && p.budget < 4) out.push({ key: 'budget', text: `meals ${BUDGET_LABEL[p.budget].toLowerCase()}` });
  if (p.stepFree) out.push({ key: 'stepFree', text: 'step-free places', ...rsvp(p.from.stepFree) });
  if (p.shortWalks) out.push({ key: 'shortWalks', text: 'close to the hotel', ...rsvp(p.from.shortWalks) });
  if (p.interests.length) {
    const names = p.interests.map((i) => INTEREST_LABEL[i].toLowerCase());
    out.push({ key: 'interests', text: names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ') });
  }
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
