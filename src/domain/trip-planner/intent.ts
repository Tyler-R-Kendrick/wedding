import { askedTime, weekdayIn } from './hours';
import { normalize } from './normalize';
import type { Day, Diet, Intent, Meal, Part, Theme } from './types';

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
  ['drinks', /\b(drinks?|cocktails?|bars?|wine|beers?|nightcap|pub|romantic|bachelor(ette)? party|stag (do|night|party)|hen (do|night|party)|night out|pub crawl|go(ing)? out drinking)\b/],
  ['architecture', /\b(architect\w*|buildings?|skyscrapers?|design|tours?)\b/],
  ['outdoors', /\b(outdoors?|outside|parks?|gardens?|nature|fresh air|trails?|hike|hiking|sunshine)\b/],
  ['museum', /\b(museums?|art|gallery|galleries|culture|cultural|exhibits?|aquarium|science|history|historic(al)?)\b/],
  ['play', /\b(games?|play|golf|fun|arcade)\b/],
  ['view', /\b(views?|rooftop|skyline|romantic)\b/],
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
  if (/\b(afternoon|lunch|midday|noon)\b/.test(text)) out.push('afternoon');
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
  /\b(calendar|ics|confirm (my|our) (plans?|weekend)|(these|those) are (my|our) plans|(my|our) (plans are|weekend is) (set|done|final)|that'?s my (plan|weekend)|i'?m (set|done) planning|export|what(('?s| is| are) (my|our) (plans?|itinerary|schedule|weekend)| (have|do) (i|we) (have |got )?(planned|saved|on))|(show|see) (me )?(my|our) (plans?|weekend|itinerary|schedule)|(when|what time) (is|does|do|are) (my|our) flights?|(my|our) flights? (lands?|leaves?|departs?|arrives?|times?|details)|what (i'?ve|ive|we'?ve|weve) (got )?(planned|saved|on)|what'?s (planned|on my (plans?|calendar))|remind me what|(do|have) (i|we) (have |got )?anything (on|planned|booked|scheduled)|is (there )?anything (on|planned|booked)|am i free|are we free|(my|our) (weekend|plans?|itinerary|schedule) (is |are )?look(s|ing)?)\b/;
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
const BUSY = /\b(i'?m|im|i am|we'?re|we are|i'?ll be|we'?ll be|i will be|we will be|mark (me|us)( as)?) (busy|not free|unavailable|booked|tied up|out)\b|\b(i|we) (can'?t|cannot|won'?t) (make|do) (it |anything )?\b/;
const ADD_OWN = /^\s*(?:please |can you |could you )?(?:add|put down|put|pencil in|write down|note|block(?: off| out)?|schedule)\s+(.+?)\s*$/;
const HAVE_OWN = /^\s*(?:im|i|we)(?:'m| am|'re| are)? (?:(?:have|having|got|'ve got|have got|going to|going)\s+(.+?)|((?!(?:looking|thinking|trying|wondering|hoping|planning|staying|arriving|landing|flying|driving|coming|leaving|getting|bringing|travell?ing|craving|wanting|needing|searching|seeking|considering|checking|asking|dying)\b)[a-z]+ing\s+.+?))\s*$/;
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

/** What the guest does not eat, as they say it. */
const DIET_WORDS: [Diet, RegExp][] = [
  ['vegan', /\b(vegans?|plant[- ]based)\b/],
  ['vegetarian', /\b(vegetarians?|veggies?|veg|meat[- ]free|no meat|do(es)?n'?t eat meat)\b/],
  ['gluten-free', /\b(gluten[- ]free|gluten|gf|celiac|coeliac)\b/],
  ['halal', /\bhalal\b/],
  ['kosher', /\bkosher\b/],
];
/** The kind of meal. We hold no prices, so "cheap" and "a splurge" are read as this. */
/** "Nothing fancy", "not too pricey": the opposite of a splurge, said by naming one. */
const NOT_FANCY = /\b(nothing|not|isn'?t|doesn'?t (have|need) to be|needn'?t be|without being)\s+(too\s+|very\s+|super\s+|that\s+|so\s+)?(fancy|pricey|expensive|upscale|formal|posh)\b/g;
/** They have said there is nothing they do not eat: that is an answer, and it is not asked again. */
const NO_DIET = /\b(no (dietary |food |diet )?(restrictions?|allerg(y|ies)|requirements?|preferences?)|(we|i|they) (can |will )?eat (anything|everything)|not (a )?pick(y|ie))\b/;
const MEAL_WORDS: [Meal, RegExp][] = [
  ['special', /\b(special|fancy|splurge|fine[- ]dining|upscale|anniversary|celebrat\w*|date night|tasting( menu)?|one great|treat ourselves|nicest|best (dinner|meal|restaurant))\b/],
  ['quick', /\b(cheap|budget|inexpensive|affordable|quick|casual|fast|grab|bite|take[- ]?out|on the go)\b/],
  ['sit-down', /\bsit[- ]down\b/],
];
/** Cuisines a guest names, each as the words a search of the neighbourhood files it under. */
const CUISINE_WORDS: [string[], RegExp][] = [
  [['pizza'], /\b(pizzas?|deep[- ]dish)\b/],
  [['mexican'], /\b(mexican|tacos?|burritos?|taqueria)\b/],
  [['burger'], /\b(burgers?|hamburgers?|cheeseburgers?)\b/],
  [['sushi'], /\bsushi\b/],
  [['japanese', 'ramen'], /\b(japanese|ramen)\b/],
  [['italian', 'pasta'], /\b(italian|pasta)\b/],
  [['chinese'], /\b(chinese|dim sum|dumplings?)\b/],
  [['indian'], /\b(indian|curry)\b/],
  [['thai'], /\bthai\b/],
  [['greek', 'mediterranean', 'middle_eastern', 'falafel', 'gyros'], /\b(mediterranean|greek|falafel|middle eastern|gyros?)\b/],
  [['seafood'], /\b(seafood|oysters?|lobster)\b/],
  [['sandwich'], /\b(sandwich(es)?|subs)\b/],
  [['donut'], /\b(donuts?|doughnuts?)\b/],
  [['hot_dog'], /\bhot dogs?\b/],
  [['bubble_tea'], /\b(boba|bubble tea)\b/],
  [['tea'], /\b(cup of tea|pot of tea|afternoon tea|tea ?(room|house|shop|place)s?|(get|have|for|proper|good|some) tea)\b/],
];
/** Whether a piece of text speaks of one of these cuisines ("Burgers, fries, and shakes"). */
export function saysCuisine(text: string, cuisines: readonly string[]): boolean {
  const t = ` ${text.toLowerCase()} `;
  return CUISINE_WORDS.some(([names, re]) => names.some((n) => cuisines.includes(n)) && re.test(t));
}

/** Cuisines by a plain name, for an answer that has to say it found none ("Thai"). */
export const CUISINE_NAME: Record<string, string> = { pizza: 'pizza', mexican: 'Mexican', burger: 'burger', sushi: 'sushi', japanese: 'Japanese', italian: 'Italian', chinese: 'Chinese', indian: 'Indian', thai: 'Thai', greek: 'Greek or Mediterranean', seafood: 'seafood', sandwich: 'sandwich', donut: 'donut', hot_dog: 'hot dog', bubble_tea: 'bubble tea', tea: 'tea' };

/** Common slips of the thumb, put right before anything is read. */
const TYPOS: [RegExp, string][] = [
  [/\bcheep\b/g, 'cheap'],
  [/\b(nite|nyt)\b/g, 'night'],
  [/\btonite\b/g, 'tonight'],
  [/\b4 (lunch|dinner|breakfast|brunch|coffee|drinks)\b/g, 'for $1'],
  [/\b(hotle|hotl|hottel)\b/g, 'hotel'],
  [/\b(restraunts?|resturants?|restaraunts?|restarants?)\b/g, 'restaurant'],
  [/\b(vegitarian|vegetarien|vegeterian)\b/g, 'vegetarian'],
  [/\b(breakfest|brekfast)\b/g, 'breakfast'],
  [/\b(dinnner|dinnr|diner(?= (recs?|recommendations?|tonight|on|for)))\b/g, 'dinner'],
  [/\b(coffe|cofee)\b/g, 'coffee'],
  [/\bmusuems?\b/g, 'museum'],
];

/**
 * What the guest rules out ("NOT a museum", "I don't drink coffee", "not dinner, we have a
 * reservation"): the words after the "not", up to the next clause. They are read for what to leave
 * out, and never for what is wanted.
 */
const NEGATED = /\b(?:not|no|never|isn'?t|aren'?t|(?:don'?t|doesn'?t|won'?t|can'?t|do not|does not) (?:want|need|drink|like|do|eat|care for)|other than|besides|instead of|except|anything but|rather than|tired of|sick of|done with|(?:(?:we|i)(?:'ve| have)? )?(?:already )?(?:did|done|saw|seen|visited|been to|went to))\s+((?:(?:a|an|the|any|more|another|our|that|too|much)\s+)*[a-z-]+(?:\s+(?:or|and|nor)\s+[a-z-]+)*(?:\s+[a-z-]+)?)/g;
/** A meal as a time of day ("after dinner", "before lunch"), not a request for one. */
const AROUND_MEAL = /\b(after|before|following|post|pre|until|till|by)[- ](dinner|supper|lunch|brunch|breakfast)\b/g;

/** A plain question about what there is to do, which wins over a mention of a flight or a check-in time. */
const DOING = /\b(what (can|could|should|might) (we|i|you|one) do|what is there to do|what'?s there to do|(some|any)thing (\w+ ){0,2}to do|things to do|kill (some )?time|in between)\b/;
/** An errand, not an outing: nothing on our list is for it, and we do not guess. */
const ERRAND = /\b(pharmac(y|ies)|drug ?store|chemist|atm|cash machine|bank|laundr(y|omat)|dry clean\w*|urgent care|hospital|doctor|dentist|grocer(y|ies)|supermarket|gas station|post office|barber|hair ?salon|nail salon|gym|phone charger|rental car|car rental)\b/;

/** Staying in: said as not leaving ("we are NOT leaving the building tonight"). */
const STAY_IN = /\b(not|n'?t|never) (leaving|going out of|setting foot outside|stepping out of) the (building|hotel)\b|\bstay(ing)? in(side)? (the hotel|the building|tonight)\b|\bwithout (leaving|going out)\b/;
/** A question about the room itself, whatever else it mentions ("is breakfast included with our room?"). */
const ROOM = /\b(breakfast (is )?included|included (with|in) (our|the|my) room|comes? with (our|the|my) room|keep (the|our|my) room|extend (our|my|the) stay|(an |one )?(extra|another|additional) night|late check[- ]?out|early check[- ]?in|check(ing)? out (on )?(mon|tues|wednes|thurs)day|room rate)\b/;
/** Getting here, said outright; and the weaker words that mean it only when nothing else is asked for. */
const ARRIVE_WEAK = /\b(fly|flying|flights?|arriv\w*|land(ing|s)?)\b/;
/** Near enough for someone who cannot go far: how near depends on how it is said. */
// A wheelchair or a walker is not itself a distance: only what they say about how far is.
const VERY_CLOSE = /\b(couple of blocks|few blocks|\d+[- ]?minute walk|can'?t (walk|manage|go) (far|more)|next door|steps away|around the corner|right (by|next to|outside))\b/;
const CLOSE = /\b(closer|closest|nearest|very close|not (too |very )?far|nothing (too |very )?far|short walk|much stamina|tire easily|close by)\b/;
const ALLERGY = /\b(shellfish|seafood|fish|peanut|tree nut|nut|dairy|lactose|egg|soy|sesame)s?\b[^.?!]{0,24}\ballerg\w*|\ballerg\w*\b[^.?!]{0,24}\b(shellfish|seafood|fish|peanut|tree nut|nut|dairy|lactose|egg|soy|sesame)s?\b|\ballerg(y|ic|ies)\b/;
const ACCESS = /\b(wheelchair|accessib\w*|step[- ]free|stairs|elevator|ramp)\b/;
/** When a place of ours opens or shuts: something we hold no record of. */
const ASKS_HOURS = /\b(what time|when) (does|do|is|are|will) [^?.!]{0,60}\b(open|close|shut)s?\b|\b(opening|closing) (hours|times?)\b/;
const FREE = /\b(free|no cost|costs? nothing|without spending)\b/;
const NOT_THAT_FREE = /\b(gluten|dairy|nut|step|sugar|meat)[- ]free\b|\bfree (morning|afternoon|evening|night|time|day|hours?|friday|saturday|sunday)\b|\b(am|are|is) (i|we|he|she) free\b|\bfree to\b/g;
/** Chains a guest asks for by name, as a search of the neighbourhood spells them. */
const BRANDS: [string, RegExp][] = [
  ['chick-fil-a', /\bchick[- ]?fil[- ]?a\b/],
  ['dunkin', /\bdunkin('|s| donuts)?\b/],
  ['starbucks', /\bstarbucks\b/],
  ['mcdonald', /\bmcdonald'?s\b/],
  ['portillo', /\bportillo'?s\b/],
  ['chipotle', /\bchipotle\b/],
  ['potbelly', /\bpotbelly\b/],
  ['panera', /\bpanera\b/],
  ['sweetgreen', /\bsweetgreen\b/],
  ['five guys', /\bfive guys\b/],
  ['giordano', /\bgiordano'?s\b/],
  ['lou malnati', /\b(lou )?malnati'?s\b/],
  ['garrett', /\bgarrett('?s)? popcorn\b/],
];
const OTHER_DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];
const PAIR = /\b(fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+(morning|afternoon|evening|night)\b/g;

const KIDS = /\b(kids?|child(ren)?|toddlers?|twins|triplets|infants?|newborns?|bab(y|ies)|famil(y|ies)|little ones?|strollers?|sons?|daughters?|niece|nephew|grandkids?|grandchild(ren)?|teen(ager)?s?|(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[- ]year[- ]olds?)\b/;
const INDOORS = /\b(rain\w*|pouring|indoors?|inside|wet|storm\w*|snow\w*|cold|freezing|bad weather|too hot|heat ?wave|sweltering|humid|\d{2,3} degrees|air[- ]?condition\w*)\b/;
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
  let text = ` ${normalize(request)} `;
  for (const [slip, right] of TYPOS) text = text.replace(slip, right);
  const days = daysIn(text);
  const parts = partsIn(text);
  // "After dinner" is the evening; it does not ask for dinner.
  for (const m of text.matchAll(AROUND_MEAL)) {
    const part: Part = m[2] === 'dinner' || m[2] === 'supper' ? (m[1] === 'before' || m[1] === 'pre' || m[1] === 'until' || m[1] === 'till' || m[1] === 'by' ? 'afternoon' : 'evening') : m[2] === 'lunch' ? 'afternoon' : 'morning';
    if (!parts.length) parts.push(part);
  }
  // "Nothing fancy" is a kind of meal, not a refusal of one.
  const plainMeal = NOT_FANCY.test(text);
  NOT_FANCY.lastIndex = 0;
  const noDiet = NO_DIET.test(text);
  // What is wanted is read from the request with what is ruled out, and meals named as times, taken away.
  const ruledOut = [...text.replace(NOT_FANCY, ' ').replace(NO_DIET, ' ').matchAll(NEGATED)].map((m) => m[1]!).join(' ; ');
  const wanted = ` ${text.replace(AROUND_MEAL, ' ').replace(NOT_FANCY, ' ').replace(NO_DIET, ' ').replace(NEGATED, ' ')} `;
  // "A five minute walk" is how far, not how long they have.
  const minutes = minutesIn(text.replace(/\b\d+[- ]?(minutes?|mins?)[- ](walk|away|from|drive|ride)\b/g, ' '));
  const kids = KIDS.test(text);
  const indoors = INDOORS.test(text.replace(HOTEL_AS_PLACE, ' '));
  const onFoot = ON_FOOT.test(text);
  const themes = THEMES.filter(([, re]) => re.test(wanted)).map(([t]) => t);
  if (kids && !themes.includes('kids')) themes.push('kids');
  if (STAY_IN.test(text) && !themes.includes('hotel')) themes.push('hotel');
  const avoid = THEMES.filter(([, re]) => re.test(` ${ruledOut} `)).map(([t]) => t).filter((t) => !themes.includes(t));
  const diet = DIET_WORDS.filter(([, re]) => re.test(text)).map(([d]) => d);
  const cuisine = [...new Set(CUISINE_WORDS.filter(([, re]) => re.test(wanted)).flatMap(([c]) => c))];
  const meal = plainMeal ? 'quick' : (MEAL_WORDS.find(([, re]) => re.test(wanted))?.[0] ?? null);
  const named = BRANDS.filter(([, re]) => re.test(text)).map(([n]) => n);
  const allergen = ALLERGY.exec(text);
  const allergy = allergen ? (allergen[1] ?? allergen[2] ?? 'food') : null;
  const avoidCuisine = [...new Set([...CUISINE_WORDS.filter(([, re]) => re.test(` ${ruledOut} `)).flatMap(([c]) => c), ...(allergy && /shellfish|seafood|fish/.test(allergy) ? ['seafood', 'fish', 'sushi', 'oyster'] : [])])].filter((c) => !cuisine.includes(c));
  // A cuisine, a diet or a chain by name is a request for somewhere to eat, whether or not it says "eat".
  if ((cuisine.length || diet.length || named.length) && !themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast' || t === 'coffee')) themes.push('food');
  const free = FREE.test(text.replace(NOT_THAT_FREE, ' '));
  const within = VERY_CLOSE.test(text) ? 400 : CLOSE.test(text) ? 900 : null;
  const pairs = [...text.matchAll(PAIR)].map((m) => [m[1]!.slice(0, 3) as Day, (m[2] === 'night' ? 'evening' : m[2]) as Part] as [Day, Part]);
  const weekday = weekdayIn(text);
  const otherDay = weekday !== null && weekday < 4 && !days.length ? OTHER_DAY[weekday]! : null;
  const asStay = text.replace(HOTEL_AS_PLACE, ' ');

  // Only the wedding's own day, and never its morning (which is free): "Saturday evening" asks for the wedding.
  const onlyTheDay = days.every((d) => d === 'sat') && !parts.includes('morning');
  // "Cocktail hour" names a part of the wedding, not a request for a bar.
  const otherThemes = themes.filter((t) => !(t === 'drinks' && /\bcocktail hour\b/.test(text)));
  const nothingElse = !otherThemes.length && minutes === null && !kids && !indoors && !onFoot && !LOOKING.test(text);
  const ofTheDay = SCHEDULE_NAMED.test(text) && !AROUND_WEDDING.test(text);
  const loose = SCHEDULE_LOOSE.test(text) && !AROUND_WEDDING.test(text) && onlyTheDay && nothingElse;

  const own = ownTitle(request, text, days.length + parts.length > 0 || otherDay !== null, minutes !== null || LOOKING.test(text) || /\?\s*$/.test(text));

  const doing = DOING.test(text);
  // A meal asked for by name ("where should we eat before our flight") is about the meal.
  const aMeal = themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast') && /\b(eat|dinner|supper|lunch|brunch|breakfast|restaurants?|food)\b/.test(wanted);

  let kind: Intent['kind'] = 'places';
  if (CALENDAR.test(text)) kind = 'calendar';
  else if (own) kind = 'own';
  else if (WEEKEND.test(text)) kind = 'weekend';
  else if (ofTheDay && onlyTheDay) kind = 'schedule';
  else if (ERRAND.test(text) && !doing) kind = 'errand';
  else if (ROOM.test(text)) kind = 'stay';
  else if (ARRIVE.test(text.replace(ARRIVE_WEAK, ' ')) && !doing && !aMeal) kind = 'arrive';
  else if (ARRIVE_WEAK.test(text) && !doing && !themes.length && !days.length) kind = 'arrive';
  else if (STAY.test(asStay) && !doing && !themes.some((t) => t !== 'hotel' && t !== 'quiet')) kind = 'stay';
  else if (loose) kind = 'schedule';
  else if (!themes.length && !days.length && !parts.length && minutes === null && !kids && !indoors && !onFoot) kind = 'open';

  // Saturday afternoon or evening named at all, even beside another day ("Saturday or Sunday evening").
  const weddingTime = days.includes('sat') && parts.some((p) => p !== 'morning');
  const asks = kind === 'schedule' ? { time: ASKS_TIME.test(text), dress: ASKS_DRESS.test(text) } : { time: false, dress: false };
  const asksHours = kind === 'places' && ASKS_HOURS.test(text);
  // The time asked about, for a search to leave out what is known to be shut then. A question about one place's hours is not that.
  const at = asksHours ? null : askedTime(text, parts[0]);
  return {
    kind, days, parts, minutes, kids, indoors, onFoot, themes, words: words(text), weddingTime, asks, diet, meal, cuisine, avoid, noDiet,
    named, allergy, avoidCuisine, free, within, access: ACCESS.test(text), asksHours, at, otherDay,
    ...(pairs.length >= 2 ? { ownSlots: pairs } : {}),
    ...(kind === 'own' && own ? { own } : {}),
  };
}
