/**
 * The trip planner's shared shapes. Pure data: the domain functions in this folder turn a guest's
 * request into a `Plan`, and `compose` turns a plan into the OpenUI Lang program the page renders.
 */

export const PRICE_LEVELS = [1, 2, 3, 4] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];
export const RESERVATIONS = ['required', 'recommended', 'walk-in', 'tickets'] as const;
export type Reservations = (typeof RESERVATIONS)[number];
export const SETTINGS = ['indoors', 'outdoors', 'both'] as const;
export type Setting = (typeof SETTINGS)[number];

/**
 * What a guest weighs before going to a place: each one read from the place's own pages and kept
 * with the recommendation (/admin/content). A fact that is absent is not known, and the planner
 * says nothing about it rather than guessing.
 */
export type PlaceFacts = {
  /** Food and drink: what one person typically spends. 1 under $15, 2 $15 to $40, 3 $40 to $100, 4 over $100. */
  priceLevel?: PriceLevel;
  /** What a ticket costs, in the couple's words ("Adults about $32"), or "Free". */
  cost?: string;
  /** Regular hours in OpenStreetMap's `opening_hours` syntax, which `hours.ts` reads. */
  hours?: string;
  /** A caveat on the hours ("Shorter hours in winter"). */
  hoursNote?: string;
  reservations?: Reservations;
  /** Diets the place's own menu marks options for. */
  diets?: Diet[];
  /** The place says it has a step-free way in (false: it says it does not). */
  stepFree?: boolean;
  /** The place's own words about getting in and around. */
  access?: string;
  setting?: Setting;
  /** The youngest age let in, when the place sets one. */
  minAge?: number;
};

/** One of the couple's recommendations, as the planner reads it. Every field comes from the site's own records. */
export type PlannerPlace = {
  id: string;
  slug: string;
  name: string;
  category: string;
  interests: string[];
  what: string;
  why?: string;
  /** The couple's own rough guide, never a promise. */
  minutes?: number;
  kidFriendly?: boolean;
  /** Price, hours, booking, diet options and access, where the couple's records hold them. */
  facts?: PlaceFacts;
  address?: string;
  lat?: number;
  lng?: number;
  /** The place's page on this site (same tab). */
  href: string;
  /**
   * A licensed photograph of the place (`src/domain/media/place-photos.ts`). `credit` is set when its
   * licence (CC BY / BY-SA) asks for the author and licence to be shown beside the picture.
   */
  image?: { src: string; alt: string; credit?: { text: string; href: string; license: { name: string; href: string } } };
};

/**
 * One of the couple's own itineraries, as the planner reads it: their title and intro (their words,
 * which the planner never rewrites), the kind of time it is for, and its stops in their order. Only
 * places the planner can offer appear as stops; an itinerary with none still lends its intro.
 */
export type PlannerItinerary = {
  slug: string;
  title: string;
  /** The couple's own words; empty when they have not written it yet. */
  intro: string;
  /** What kind of time it is for: a stretch of time, a day and part, who is coming, or a kind of thing. */
  bucket: string;
  minMinutes?: number;
  maxMinutes?: number;
  interests: string[];
  stops: { placeId: string; minutes?: number }[];
};

export const DAYS = ['fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export const PARTS = ['morning', 'afternoon', 'evening'] as const;
export type Part = (typeof PARTS)[number];

/**
 * A place the guest saved to their plans, and when. `day` is its day of the wedding weekend; a place
 * on a day of the guest's stay outside Friday to Sunday carries that day's own `date` ("YYYY-MM-DD")
 * too, and `day` is then the weekend day nearest it, never one the weekend planner plans around.
 */
export type SavedItem = { id: string; day: Day; part: Part; name?: string; date?: string; /** The guest's own plan ("Dinner with family"), not one of our places. */ own?: boolean };

export type PlanShape = 'picks' | 'route' | 'budget' | 'switch' | 'stay' | 'arrive' | 'ask' | 'weekend' | 'calendar' | 'schedule' | 'own' | 'clarify';

/** What a guest does not eat, as a search can filter on it. */
export const DIETS = ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'] as const;
export type Diet = (typeof DIETS)[number];
/** The kind of meal: we hold no prices, so "budget" is asked and answered as this. */
export const MEALS = ['quick', 'sit-down', 'special'] as const;
export type Meal = (typeof MEALS)[number];
/** What the guest has told the planner about themselves in this visit. `asked`: they have been asked, so they are not asked again. */
export type Prefs = { diet: Diet[]; meal: Meal | null; asked: boolean };

/** A kind of place a search of the neighbourhood can find. */
export const OUTSIDE_KINDS = ['restaurant', 'cafe', 'fast_food', 'bar', 'museum', 'attraction', 'park', 'playground'] as const;
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];
/** A place that is not one of the couple's own, as a search found it (OpenStreetMap's own facts about it). */
export type OutsidePlace = { id: string; name: string; kind: OutsideKind; cuisine: string[]; diet: Diet[]; address?: string; lat: number; lng: number; website?: string; hours?: string };
/** What to look for near the hotel. Never the guest's own words. */
export type OutsideQuery = {
  kinds: OutsideKind[];
  diet: Diet[];
  cuisine: string[];
  meal?: Meal;
  limit: number;
  /** Kinds of place ruled out, by a word in the name ("museum"). */
  notNamed?: string[];
  /** Words of the request, to put a place whose name has one first. They stay on our own server. */
  words?: string[];
  /** A chain asked for by name: only places of that name. */
  named?: string[];
  /** Cuisines ruled out. */
  notCuisine?: string[];
  /** No further than this from the hotel, in metres. */
  within?: number;
  /** The time asked about: places known to be shut then are left out. */
  at?: { weekday: number; from: number; to: number };
};
/** A found place chosen for an answer, with how far it is and one line about it. */
export type OutsidePick = OutsidePlace & { meters: number; detail: string };
/** One thing a clarifying question asks, as a set of choices. */
export type ClarifyGroup = { id: 'diet' | 'meal'; label: string; multi: boolean; options: { value: string; label: string }[] };

export type PlanPick = {
  id: string;
  note?: string;
  day?: Day;
  part?: Part;
  /** The couple's own minutes for this stop of an itinerary (the time tool reads it before the place's). */
  minutes?: number;
};

export type Plan = {
  shape: PlanShape;
  title: string;
  intro: string;
  picks: PlanPick[];
  /** `switch`: the sets a SegmentedControl moves between. */
  groups?: { label: string; ids: string[] }[];
  /** `budget`: the time the guest said they have. */
  minutes?: number;
  /** `ask`: the one question the planner needs answered. */
  question?: { text: string; options: { label: string; note?: string }[] };
  /** Two or three follow-up requests, in the guest's voice. */
  next: string[];
  /** Ids the writer may choose from (the draft's candidates, best first). Not rendered. */
  candidates?: string[];
  /**
   * The answer comes from one of the couple's itineraries: `stops` is how many of the first picks
   * are its stops, in its order; the rest are extras from the wider list.
   */
  itinerary?: { slug: string; stops: number };
  /**
   * A route of the planner's own (not the couple's): `stops` is how many of the first picks are its
   * stops, ordered and fitted to the part of the day; the rest are good too, for another time.
   */
  route?: { stops: number };
  /** Words the writer must leave alone: the couple's own, or an answer that must say exactly this. */
  fixed?: ('title' | 'intro')[];
  /** `own`: something of the guest's own to put in their plans, and the times it could go. */
  own?: { title: string; slots: { day: Day; part: Part }[] };
  /** `schedule`: one fact was asked for (a time, what to wear), so the answer stops at the events. */
  brief?: boolean;
  /** `clarify`: the request, and what is asked before it is answered. */
  clarify?: { request: string; groups: ClarifyGroup[] };
  /** What to look for beyond our own list, for the page to search and `compose` to show after our picks. */
  outside?: OutsideQuery;
  /** Where a place from outside our list would go if the guest adds it. */
  outsideSlot?: { day: Day; part: Part };
};

export type Theme =
  | 'coffee'
  | 'breakfast'
  | 'dinner'
  | 'food'
  | 'drinks'
  | 'architecture'
  | 'outdoors'
  | 'museum'
  | 'kids'
  | 'play'
  | 'view'
  | 'quiet'
  | 'hotel'
  | 'day-trip'
  | 'walk'
  | 'water'
  | 'love';

/** What a request asks for, read by plain rules. */
export type Intent = {
  kind: 'places' | 'stay' | 'arrive' | 'weekend' | 'calendar' | 'schedule' | 'open' | 'own' | 'errand';
  days: Day[];
  parts: Part[];
  /** "two hours", "90 minutes". */
  minutes: number | null;
  kids: boolean;
  /** Rain, indoors, inside. */
  indoors: boolean;
  onFoot: boolean;
  themes: Theme[];
  /** The request's content words, lower-cased, for matching against the places' own copy. */
  words: string[];
  /** The guest asked for Saturday afternoon or evening, which belongs to the wedding. */
  weddingTime: boolean;
  /** A question about the wedding itself: what time something starts, or what to wear. */
  asks: { time: boolean; dress: boolean };
  /** The guest told us something of their own ("I'm busy Friday night", "add dinner with my parents on Friday"): its name. */
  own?: string;
  /** What the request says the guest does not eat. */
  diet: Diet[];
  /** The kind of meal the request asks for ("cheap", "a splurge"), if it says. */
  meal: Meal | null;
  /** Cuisines named in the request, in a search's own words ("pizza", "mexican"). */
  cuisine: string[];
  /** Kinds of thing the request rules out ("NOT a museum", "not dinner"). */
  avoid: Theme[];
  /** They said there is nothing they do not eat. */
  noDiet: boolean;
  /** Chains asked for by name ("chick-fil-a"), as a search spells them. */
  named: string[];
  /** An allergy they told us of. We can vouch for no kitchen on it, and say so. */
  allergy: string | null;
  /** Cuisines ruled out ("anything but pizza or burgers"). */
  avoidCuisine: string[];
  /** They asked for something that costs nothing. */
  free: boolean;
  /** How near it has to be, in metres, when they said they cannot go far. */
  within: number | null;
  /** They asked about wheelchair or step-free access. */
  access: boolean;
  /** They asked when a place opens or shuts. */
  asksHours: boolean;
  /** The day of the week (Monday is 0) a question about a place's hours is for, when it names one. */
  hoursDay?: number | null;
  /** The day and time asked about, so places known to be shut then are left out. */
  at: { weekday: number; from: number; to: number } | null;
  /** The day and time the request names, whether or not it reads as a question about one place's hours; and the part of the day a clock time in it falls in. */
  when?: { weekday: number; from: number; to: number } | null;
  whenPart?: Part | null;
  /** A day outside the wedding weekend that the request is about ("Thursday"). */
  otherDay: string | null;
  /** A plan of their own at several times, each day with its own part ("Friday afternoon and Sunday morning"). */
  ownSlots?: [Day, Part][];
  /** The most they said one person should spend ("under $20", "cheap"), as a price level. */
  budget?: PriceLevel | null;
  /** They said this one is for the grown-ups ("date night", "without the kids"). */
  grownUps?: boolean;
  /** Nothing is booked and they want to walk in ("where can we just turn up"). */
  walkIn?: boolean;
  /** A first-time visitor's question: the few things not to miss. */
  mustSee?: boolean;
  /**
   * Who the answer is for, from the guest's profile, where the request itself did not say: folded in
   * by `draftPlan`, never read from the request's words.
   */
  who?: { stepFree: boolean; kidsAlong: boolean; interests: Theme[]; allergy?: string | null };
  /** What they eat, from this request or what they told us before, for a meal: a menu we have read that does not mark it is passed over. */
  eats?: Diet[];
};

/**
 * One of the wedding's own events, as the couple set it in /admin/events and the guest's invitation
 * carries it (`list_my_events`). Every field is the couple's; one they have not set is absent, and
 * the planner says so rather than filling it in.
 */
export type WeddingEventInput = {
  id: string;
  name: string;
  dateIso: string;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  /** The couple's own words about it, settled sentences only. */
  description?: string | null;
  /** The room at the venue, by name, once it is chosen. */
  room?: string | null;
  /** Where it is, as one line for a calendar: the room, the venue and its address. */
  location?: string | null;
  dressCode?: string | null;
  accessibilityNote?: string | null;
  /** The couple marked its details as not confirmed yet. */
  unconfirmed?: boolean;
};

/** One entry on the guest's calendar: a wedding event, a place they planned, or their own travel. */
export type CalendarWhen =
  | { kind: 'allDay'; date: string }
  | { kind: 'local'; date: string; start: string; end: string }
  | { kind: 'instant'; start: string; end?: string | null };

export type CalendarEntry = {
  uid: string;
  source: 'wedding' | 'plan' | 'trip';
  title: string;
  when: CalendarWhen;
  location?: string;
  description?: string;
  url?: string;
  /** A wedding event whose time is not announced yet. */
  tbd?: boolean;
  /** A plan the guest put in a part of a day: it has no clock time of its own, only that part. */
  part?: Part;
};

export type CalendarDayModel = {
  date: string;
  label: string;
  entries: { uid: string; title: string; time: string | null; source: CalendarEntry['source']; note?: string }[];
};

export type ComposeContext = {
  places: ReadonlyMap<string, PlannerPlace>;
  saved: readonly SavedItem[];
  /** The `calendar` shape's days (from `calendarModel`). */
  calendar?: readonly CalendarDayModel[];
  /** The `schedule` shape's events, as the guest's invitation carries them. */
  events?: readonly WeddingEventInput[];
  /** What the search for `plan.outside` found and `pickOutside` chose. Absent: not searched (or it failed); empty: searched, nothing fits. */
  outside?: readonly OutsidePick[];
  /** The wedding hotel's position: a day's route starts from it and returns to it. */
  hotel?: { lat: number; lng: number } | null;
};
