import { ageWords, dietWords, openOn, priceWords, reservationWords } from '@/domain/content/place-facts';
import { openIn, weekdayOfDate } from './hours';
import { sellsFood } from './price';
import type { Diet, Part, PlannerPlace } from './types';

/**
 * What to know before going to a place, as the few short facts a card shows: what it costs, whether
 * it is open at the time in question, whether to book, and what matters to this guest (a step-free
 * way in, what they eat). Only what the place's own record holds: a fact that is absent is left
 * out, never guessed. The one exception is what a place to eat costs, which a guest compares across
 * a list: with no checked price it carries our guess, said as one ("Likely $$"), or, with nothing
 * to guess from, says that the price is not known, with a mark where the price would be.
 * `shut` is the one thing said as a warning: the place is not open at that time.
 */
export type Know = { items: { key: string; text: string; /** Shown before the words, for the eye only. */ mark?: string; tone?: 'guess' | 'unknown' }[]; shut: string | null };
/** Where a price's symbols would be, for a place whose price is not known. */
export const PRICE_UNKNOWN_MARK = '$?';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PART_WORDS: Record<Part, string> = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };

export function knowBeforeYouGo(place: PlannerPlace, when: { date: string; part: Part } | null, who?: { stepFree: boolean; diet: readonly Diet[] }): Know {
  const f = place.facts ?? {};
  const items: Know['items'] = [];
  let shut: string | null = null;
  const price = priceWords(f.priceLevel);
  // The symbols guests know from elsewhere, with what they mean here beside them.
  if (price) items.push({ key: 'price', text: `${price.symbol}, ${price.range}` });
  else if (sellsFood(place)) {
    const guess = priceWords(f.priceGuess);
    items.push(guess ? { key: 'price', text: `Likely ${guess.symbol}, ${guess.range}`, tone: 'guess' } : { key: 'price', text: 'Price not known', mark: PRICE_UNKNOWN_MARK, tone: 'unknown' });
  }
  // A ticket price runs long; the card carries its first clause and the place's page the rest.
  if (f.cost) items.push({ key: 'cost', text: f.cost.split(';')[0]!.trim().replace(/\.$/, '') });
  if (when && f.hours) {
    const weekday = weekdayOfDate(when.date);
    const day = WEEKDAYS[weekday]!;
    // `openOn` counts days from Sunday; the planner's own hours helpers count from Monday.
    const open = openOn(f.hours, (weekday + 1) % 7);
    if (open && !open.open) shut = `Closed on ${day}s.`;
    else if (open?.open && openIn(f.hours, weekday, when.part) === false) shut = `Open ${open.text} on ${day}s, so not in the ${PART_WORDS[when.part]}.`;
    else if (open?.open) items.push({ key: 'hours', text: `Open ${open.text} on ${day}` });
  }
  const booking = f.reservations && f.reservations !== 'walk-in' ? reservationWords(f.reservations) : null;
  if (booking) items.push({ key: 'booking', text: booking });
  // A step-free way in is said where the place says it has one; where it does not say, a guest who
  // needs one is told to call, in words that cannot be skimmed as a yes.
  if (f.stepFree === false) items.push({ key: 'stepFree', text: 'No step-free way in' });
  else if (who?.stepFree) items.push({ key: 'stepFree', text: f.stepFree ? 'Step-free way in' : 'Call ahead about access' });
  // What the menu marks, for what this guest eats. A menu that does not mark it is not named: the answer says to ask.
  const marked = who?.diet.filter((d) => f.diets?.includes(d)) ?? [];
  const eats = marked.length ? dietWords(marked) : null;
  if (eats) items.push({ key: 'diets', text: eats });
  const ages = ageWords(f.minAge);
  if (ages) items.push({ key: 'ages', text: ages });
  return { items, shut };
}
