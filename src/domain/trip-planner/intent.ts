import type { Day, Intent, Part, Theme } from './types';

/**
 * Reads a guest's request with plain rules: which day and part of the day, how long, who is coming,
 * what kind of thing. Deterministic, so the planner answers the same way on every device, with or
 * without the matching model.
 */

const STOP = new Set(
  'a an and any are around at be can could do does for from get go going have here how i if in is it its just like me more my near need of on or our plan please show so some something somewhere the then there these thing things this to up us want we what when where which while who will with would you your about after before into than that them they too very also really maybe should'.split(' '),
);

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, few: 3 };

const THEMES: [Theme, RegExp][] = [
  ['coffee', /\b(coffee|espresso|latte|cappuccino|caf[eé]s?|roaster(y|ies)?|roast)\b/],
  ['breakfast', /\b(breakfast|brunch|pastr(y|ies)|bakery|baked|croissants?)\b/],
  ['dinner', /\b(dinner|supper|tasting( menu)?|steak(house)?|fancy|date night|special meal)\b/],
  ['food', /\b(food|eat|eating|lunch|restaurants?|hungry|bite|pizza|deep[ -]dish|burgers?|snacks?|meal)\b/],
  ['drinks', /\b(drinks?|cocktails?|bars?|wine|beers?|nightcap|pub)\b/],
  ['architecture', /\b(architect\w*|buildings?|skyscrapers?|design|tours?)\b/],
  ['outdoors', /\b(outdoors?|outside|parks?|gardens?|nature|fresh air|trails?|hike|hiking|sunshine)\b/],
  ['museum', /\b(museums?|art|gallery|galleries|culture|cultural|exhibits?|aquarium|science)\b/],
  ['play', /\b(games?|play|golf|fun|arcade)\b/],
  ['view', /\b(views?|rooftop|skyline)\b/],
  ['quiet', /\b(quiet|relax\w*|calm|slow|low[ -]key|chill|unwind|rest)\b/],
  ['hotel', /\b(in|inside|at|without leaving) the (hotel|building)\b|\bdownstairs\b|\bstay in\b/],
  ['day-trip', /\b(day[ -]trip|out of town|drive out|whole day out|a full day)\b/],
  ['walk', /\b(walks?|walking|stroll|on foot|walkable)\b/],
  ['water', /\b(river|boat|cruise|water|lakefront)\b/],
  ['love', /\b(your story|you two|your favou?rites?|you love|special to you|meant something|where you met)\b/],
];

function minutesIn(text: string): number | null {
  if (/\b(an|one) hour and a half\b|\bhour and a half\b/.test(text)) return 90;
  if (/\bhalf (an|a) hour\b/.test(text)) return 30;
  if (/\b(a )?couple( of)? hours\b/.test(text)) return 120;
  if (/\b(a )?few hours\b/.test(text)) return 180;
  const hours = /\b(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight)(?:\s*(?:and a half|½))?\s*(?:-|\s)?\s*(hours?|hrs?|h)\b/.exec(text);
  if (hours) {
    const raw = hours[1]!;
    let n = NUMBER_WORDS[raw] ?? Number(raw);
    if (/and a half|½/.test(hours[0])) n += 0.5;
    if (Number.isFinite(n) && n > 0) return clampMinutes(Math.round(n * 60));
  }
  const mins = /\b(\d+)\s*(minutes?|mins?|m)\b/.exec(text);
  if (mins) {
    const n = Number(mins[1]);
    if (Number.isFinite(n) && n > 0) return clampMinutes(n);
  }
  return null;
}

const clampMinutes = (n: number) => Math.min(600, Math.max(15, n));

function daysIn(text: string): Day[] {
  const out: Day[] = [];
  if (/\b(fri(day)?|the night before|when we (arrive|get in))\b/.test(text)) out.push('fri');
  if (/\b(sat(urday)?|wedding day|day of the wedding)\b/.test(text)) out.push('sat');
  if (/\b(sun(day)?|before (we|i) (leave|fly home|head home)|day after)\b/.test(text)) out.push('sun');
  return out;
}

function partsIn(text: string): Part[] {
  const out: Part[] = [];
  if (/\b(morning|breakfast|brunch|early)\b/.test(text)) out.push('morning');
  if (/\b(afternoon|lunch|midday)\b/.test(text)) out.push('afternoon');
  if (/\b(evening|night|tonight|dinner|supper|nightcap|late)\b/.test(text)) out.push('evening');
  return out;
}

/** "near the hotel" is a place to start from, not a question about where to stay. */
const HOTEL_AS_PLACE = /\b(near|from|in|inside|at|around|by|close to|leaving|back to|walk(ing)? to|of) (the|our|your) hotel\b/g;

const STAY = /\b(where (should|do|can|could) (i|we) stay|place to stay|room block|book (a|the|our) room|rooms?\b.*\bblock|hotels?|accommodations?|lodging|stay(ing)? (at|in|nearby|near)|check[ -]in|group rate|group code)\b/;
const ARRIVE = /\b(where (do|can|should|could) (i|we) park|airports?|fly|flying|flights?|o['’]?hare|midway|parking|park (the|my|our) car|driv(e|ing) (in|here|there|to)|getting (here|there|in|downtown)|get (here|there|downtown)|arriv\w*|blue line|valet|train from)\b/;
const WEEKEND = /\b((whole|entire|full|all) (of )?(the |my |our )?weekend|plan (my|our|the) (whole )?(weekend|trip|stay)|weekend plan|plan everything|fill (my|our) weekend)\b/;
/** The guest's own plans, as they stand: "show my calendar", "what are my plans", "what is my weekend looking like". */
const CALENDAR =
  /\b(calendar|ics|confirm (my|our) (plans?|weekend)|(these|those) are (my|our) plans|(my|our) (plans are|weekend is) (set|done|final)|that'?s my (plan|weekend)|i'?m (set|done) planning|export|what(('?s| is| are) (my|our) (plans?|itinerary|schedule|weekend)| (have|do) (i|we) (have |got )?(planned|saved|on))|(show|see) (me )?(my|our) (plans?|weekend|itinerary|schedule)|(my|our) flights?|(my|our) (weekend|plans?|itinerary|schedule) (is |are )?look(s|ing)?)\b/;
/**
 * The wedding itself. A named part of the day or what to wear is always a question about the
 * schedule ("what time is the ceremony", "is there a dress code"); a looser one ("Saturday night",
 * "what time", "the wedding day") only when the request asks for nothing else, so "Saturday evening
 * drinks" and "a free Saturday morning before the wedding" stay requests for places.
 */
const SCHEDULE_NAMED = /\b(ceremony|ceremonies|reception|cocktail hour|dress[ -]?code|attire|black[ -]tie|(what|how) (should|do|can|to|will) (i|we)? ?(wear|dress)|what to wear|vows)\b/;
const SCHEDULE_LOOSE = /\b(schedule|timeline|order of (the )?(day|events)|what time|when (is|does|do|are|will|should)|what'?s happening|what is happening|wedding|saturday (afternoon|evening|night))\b/;
const AROUND_WEDDING = /\b(before|after|around|ahead of) the (wedding|ceremony|reception)\b/;
/** Words that ask for something to do, which the schedule does not answer. */
const LOOKING = /\b(something|somewhere|anything|things to|ideas?|plan|visit|explore|free|(to|we|i|you) do)\b/;
const ASKS_TIME = /\b(what time|when|start(s|ing)?|begin(s|ning)?|end(s|ing)?|finish(es)?|times?|schedule|timeline)\b/;
const ASKS_DRESS = /\b(dress[ -]?code|attire|wear|dress|black[ -]tie|formal)\b/;

/**
 * Something of the guest's own, said rather than asked: they are busy then, or they want a plan of
 * theirs written down. It is theirs to add, never a request for our places.
 */
const BUSY = /\b(i'?m|i am|we'?re|we are|i'?ll be|we'?ll be|i will be|we will be|mark (me|us)( as)?) (busy|not free|unavailable|booked|tied up|out)\b|\b(i|we) (can'?t|cannot|won'?t) (make|do) (it |anything )?\b/;
const ADD_OWN = /^\s*(?:please |can you |could you )?(?:add|put|pencil in|write down|note|block(?: off| out)?|schedule)\s+(.+?)\s*$/;
const HAVE_OWN = /^\s*(?:i|we)(?:'m| am|'re| are)? (?:(?:have|having|got|'ve got|have got|going to|going)\s+(.+?)|((?:meeting|seeing|visiting)\s+.+?))\s*$/;
/** Where and when, said at the end of such a sentence: taken off its name. */
const OWN_TAIL = /\s*\b(?:(?:on|for|to|in|at|this|that)\s+)?(?:(?:the|my|our)\s+)?(?:fri(?:day)?|sat(?:urday)?|sun(?:day)?|morning|afternoon|evening|night|tonight|plans?|calendar|itinerary|weekend|schedule)\b\s*/g;

/** The name of the guest's own plan, in their words and their capitals, or null when the request is not one. */
function ownTitle(request: string, text: string, hasWhen: boolean, looking: boolean): string | null {
  if (!hasWhen) return null;
  if (BUSY.test(text)) return 'Busy';
  if (looking) return null;
  const raw = String(request ?? '').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  const m = ADD_OWN.exec(raw.toLowerCase()) ?? HAVE_OWN.exec(raw.toLowerCase());
  const said = m?.[1] ?? m?.[2];
  if (!said) return null;
  // The same span of the guest's own words, so "Aunt Ruth" keeps her capitals.
  const name = raw.slice(raw.length - said.length).replace(new RegExp(OWN_TAIL.source, 'gi'), ' ').replace(/\s+/g, ' ').replace(/^(?:a|an|to)\s+/i, '').replace(/\s+(?:on|for|to|in|at|this)$/i, '').trim();
  // "Block off Sunday morning" names a time and nothing else: that time is taken.
  if (name.length < 2) return /^\s*(?:please )?block\b/i.test(raw) ? 'Busy' : null;
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 80);
}

const KIDS = /\b(kids?|child(ren)?|toddlers?|bab(y|ies)|famil(y|ies)|little ones?|strollers?|son|daughter)\b/;
const INDOORS = /\b(rain\w*|indoors?|inside|wet|storm\w*|cold|bad weather)\b/;
const ON_FOOT = /\b(on foot|walk\w*|nearby|close by|near (the|our) hotel|around the hotel|no car|without a car)\b/;

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function understand(request: string): Intent {
  const text = ` ${String(request ?? '').toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ')} `;
  const days = daysIn(text);
  const parts = partsIn(text);
  const minutes = minutesIn(text);
  const kids = KIDS.test(text);
  const indoors = INDOORS.test(text.replace(HOTEL_AS_PLACE, ' '));
  const onFoot = ON_FOOT.test(text);
  const themes = THEMES.filter(([, re]) => re.test(text)).map(([t]) => t);
  if (kids && !themes.includes('kids')) themes.push('kids');
  const asStay = text.replace(HOTEL_AS_PLACE, ' ');

  // Only the wedding's own day, and never its morning (which is free): "Saturday evening" asks for the wedding.
  const onlyTheDay = days.every((d) => d === 'sat') && !parts.includes('morning');
  // "Cocktail hour" names a part of the wedding, not a request for a bar.
  const otherThemes = themes.filter((t) => !(t === 'drinks' && /\bcocktail hour\b/.test(text)));
  const nothingElse = !otherThemes.length && minutes === null && !kids && !indoors && !onFoot && !LOOKING.test(text);
  const named = SCHEDULE_NAMED.test(text) && !AROUND_WEDDING.test(text);
  const loose = SCHEDULE_LOOSE.test(text) && !AROUND_WEDDING.test(text) && onlyTheDay && nothingElse;

  const own = ownTitle(request, text, days.length + parts.length > 0, minutes !== null || LOOKING.test(text) || /\?\s*$/.test(text));

  let kind: Intent['kind'] = 'places';
  if (CALENDAR.test(text)) kind = 'calendar';
  else if (own) kind = 'own';
  else if (WEEKEND.test(text)) kind = 'weekend';
  else if (named && onlyTheDay) kind = 'schedule';
  else if (ARRIVE.test(text)) kind = 'arrive';
  else if (STAY.test(asStay) && !themes.some((t) => t !== 'hotel' && t !== 'quiet')) kind = 'stay';
  else if (loose) kind = 'schedule';
  else if (!themes.length && !days.length && !parts.length && minutes === null && !kids && !indoors && !onFoot) kind = 'open';

  // Saturday afternoon or evening named at all, even beside another day ("Saturday or Sunday evening").
  const weddingTime = days.includes('sat') && parts.some((p) => p !== 'morning');
  const asks = kind === 'schedule' ? { time: ASKS_TIME.test(text), dress: ASKS_DRESS.test(text) } : { time: false, dress: false };
  return { kind, days, parts, minutes, kids, indoors, onFoot, themes, words: words(text), weddingTime, asks, ...(kind === 'own' && own ? { own } : {}) };
}
