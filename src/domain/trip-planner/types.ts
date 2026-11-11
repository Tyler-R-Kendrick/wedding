/**
 * The trip planner's shared shapes. Pure data: the domain functions in this folder turn a guest's
 * request into a `Plan`, and `compose` turns a plan into the OpenUI Lang program the page renders.
 */

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
  address?: string;
  lat?: number;
  lng?: number;
  /** The place's page on this site (same tab). */
  href: string;
  /**
   * A licensed photograph of the place (`src/domain/media/place-photos.ts`). `credit` is set when its
   * licence (CC BY / BY-SA) asks for the author and licence to be shown beside the picture.
   */
  image?: { src: string; alt: string; credit?: { text: string; href: string } };
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

/** A place the guest saved to "My weekend", and when. */
export type SavedItem = { id: string; day: Day; part: Part; name?: string };

export type PlanShape = 'picks' | 'route' | 'budget' | 'switch' | 'stay' | 'arrive' | 'ask' | 'weekend' | 'calendar' | 'schedule';

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
  /** Words the writer must leave alone: the couple's own, or an answer that must say exactly this. */
  fixed?: ('title' | 'intro')[];
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
  kind: 'places' | 'stay' | 'arrive' | 'weekend' | 'calendar' | 'schedule' | 'open';
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
};
