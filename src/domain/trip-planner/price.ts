import type { PlannerPlace, PriceLevel } from './types';

/**
 * A price for a place whose record holds none: a guess, and always shown as one ("Likely $$").
 *
 * The guess is read from what the place says it is (a tasting menu, a steakhouse, a coffee bar, a
 * pizza place), then set by what the places of that kind on the couple's own list are known to
 * cost, when two or more of them have a checked price. A place that says nothing of the kind is
 * not guessed at: its card says the price is not known.
 */
const KINDS: readonly [kind: string, says: RegExp, usually: PriceLevel][] = [
  ['fine', /\b(tasting[- ]menus?|fine[- ]dining|michelin|prix[- ]fixe|omakase|chef'?s (table|counter))\b/, 4],
  ['upscale', /\b(steak ?houses?|chophouses?|upscale|white[- ]tablecloth|cocktails?|supper club|raw bar|oysters?|wine bar)\b/, 3],
  ['coffee', /\b(coffee|espresso|pour[- ]overs?|lattes?|roast(s|ers?|ery)|caf[eé]s?|baker(y|ies)|baked goods|pastr(y|ies)|donuts?|doughnuts?|bagels?|tea ?(house|room)|ice cream|gelato|popcorn)\b/, 1],
  ['casual', /\b(pizza|deep[- ]dish|burgers?|taverns?|pubs?|diners?|brunch|tacos?|noodles?|ramen|bbq|barbecue|brewer(y|ies)|taprooms?|casual|sandwich(es)?|hot dogs?|italian beef|food halls?|counter)\b/, 2],
];

/** Somewhere to eat or drink: the only places a price level is kept for. */
export const sellsFood = (p: PlannerPlace) => p.interests.includes('food') || p.interests.includes('dinner') || p.category === 'food-drink';

const kindOf = (p: PlannerPlace) => {
  const text = `${p.name} ${p.what}`.toLowerCase();
  return KINDS.find(([, says]) => says.test(text)) ?? null;
};

/** The guess for one place, given the list it is on. Null: nothing to go on. */
export function guessPrice(place: PlannerPlace, places: readonly PlannerPlace[]): PriceLevel | null {
  if (place.facts?.priceLevel || !sellsFood(place)) return null;
  const kind = kindOf(place);
  if (!kind) return null;
  const peers = places
    .filter((p) => p.id !== place.id && sellsFood(p) && p.facts?.priceLevel && kindOf(p)?.[0] === kind[0])
    .map((p) => p.facts!.priceLevel!)
    .sort((a, b) => a - b);
  // The middle one of what its peers cost (the lower of two middles), when there are peers to go by.
  return peers.length >= 2 ? peers[Math.floor((peers.length - 1) / 2)]! : kind[2];
}

/** The list with a guess on each place to eat that has no checked price and can be guessed at. */
export function withPriceGuesses(places: readonly PlannerPlace[]): PlannerPlace[] {
  return places.map((p) => {
    const guess = guessPrice(p, places);
    return guess ? { ...p, facts: { ...p.facts, priceGuess: guess } } : p;
  });
}

/** What a place costs as far as we can tell: its checked price, else the guess. Whether it is a guess is the caller's to say. */
export const priceOf = (p: PlannerPlace): PriceLevel | null => p.facts?.priceLevel ?? p.facts?.priceGuess ?? null;
