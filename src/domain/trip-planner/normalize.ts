/**
 * A guest's words as the rules read them: emoji that stand for a word, the commonest words of a
 * request in Spanish and French, and slips of the thumb put right ("dinenr" is "dinner"). Only the
 * words the planner itself knows are corrected to, and only from something very near them, so a
 * word that is merely unfamiliar is left alone.
 */

const EMOJI: [RegExp, string][] = [
  [/🍕/gu, ' pizza '],
  [/🍔/gu, ' burger '],
  [/🍣/gu, ' sushi '],
  [/☕/gu, ' coffee '],
  [/[🍺🍻🍷🍸🍹🥂]/gu, ' drinks '],
  [/[🌮🌯]/gu, ' tacos '],
  [/🍜/gu, ' ramen '],
  [/🍩/gu, ' donuts '],
  [/🍝/gu, ' pasta '],
  [/🥗/gu, ' vegetarian '],
];

/** Spanish and French, word for word: enough for where, when, what kind of meal and what they eat. */
const FOREIGN: Record<string, string> = {
  copa: 'cocktail', copas: 'cocktails', trago: 'drink', tragos: 'drinks', cóctel: 'cocktail', coctel: 'cocktail', cócteles: 'cocktails', cocteles: 'cocktails', bebida: 'drink', bebidas: 'drinks', tomar: 'have', beber: 'drink', bar: 'bar', verre: 'drink', boire: 'drink',
  dónde: 'where', donde: 'where', podemos: 'can we', puedo: 'can i', cenar: 'eat dinner', cena: 'dinner', comer: 'eat', almorzar: 'eat lunch', almuerzo: 'lunch',
  desayuno: 'breakfast', desayunar: 'eat breakfast', viernes: 'friday', sábado: 'saturday', sabado: 'saturday', domingo: 'sunday', noche: 'night', mañana: 'morning',
  tarde: 'afternoon', vegetarianos: 'vegetarian', vegetariano: 'vegetarian', vegetariana: 'vegetarian', vegetarianas: 'vegetarian', veganos: 'vegan', vegano: 'vegan',
  vegana: 'vegan', restaurante: 'restaurant', restaurantes: 'restaurants', niños: 'kids', museo: 'museum', museos: 'museums', cerca: 'near', somos: 'we are',
  cerveza: 'beer', bueno: 'good', buen: 'good', barato: 'cheap', barata: 'cheap', parque: 'park',
  où: 'where', dîner: 'dinner', déjeuner: 'lunch', manger: 'eat', vendredi: 'friday', samedi: 'saturday', dimanche: 'sunday', soir: 'evening', matin: 'morning',
  végétarien: 'vegetarian', végétarienne: 'vegetarian', végétariens: 'vegetarian', végétalien: 'vegan', végétalienne: 'vegan', café: 'coffee', près: 'near',
  hôtel: 'hotel', enfants: 'kids', musée: 'museum', musées: 'museums', bon: 'good', bonne: 'good', pas: 'not', cher: 'expensive',
};

/** The words worth correcting to: the ones the rules turn on. Five letters or more, so a short everyday word is never rewritten. */
const KNOWN = [
  'where', 'dinner', 'lunch', 'breakfast', 'brunch', 'restaurant', 'restaurants', 'vegetarian', 'vegan', 'friendly', 'friday', 'saturday', 'sunday', 'tonight', 'night',
  'coffee', 'museum', 'museums', 'cheap', 'hotel', 'somewhere', 'anywhere', 'something', 'anything', 'pizza', 'burger', 'burgers', 'sushi', 'mexican', 'italian', 'drinks',
  'cocktail', 'cocktails', 'evening', 'morning', 'afternoon', 'recommendations', 'gluten', 'kosher', 'halal', 'children', 'weekend', 'wedding', 'ceremony', 'reception',
  'nearby', 'playground', 'architecture', 'outdoors', 'quick', 'fancy', 'special', 'thursday', 'monday', 'tuesday', 'wednesday', 'airport', 'parking',
];
const KNOWN_SET = new Set(KNOWN);
/** Real words that sit one slip away from one of ours and must stay as they are. */
const LEAVE = new Set(['diner', 'diners', 'hostel', 'motel', 'quite', 'quiet', 'sundae', 'launch', 'punch', 'bunch', 'mexico', 'italy', 'weeknight', 'special', 'nights', 'wedded', 'coffees', 'fiancé', 'fiance', 'vegas', 'began', 'pizzas', 'hotels', 'morn', 'noon', 'eight', 'might', 'right', 'light', 'sight', 'fight', 'tight', 'chef', 'cheat', 'chap', 'cheep']);

/** Edits between two words, a swap of neighbours counting as one; stops counting past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)];
  for (let i = 1; i <= a.length; i++) {
    rows[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = d;
    }
  }
  return rows[a.length]![b.length]!;
}

function nearest(word: string): string {
  if (word.length < 5 || KNOWN_SET.has(word) || LEAVE.has(word) || /[^a-z]/.test(word)) return word;
  const max = word.length >= 8 ? 2 : 1;
  let best = word;
  let bestAt = max + 1;
  for (const k of KNOWN) {
    // A slip rarely changes the first letter, and never the length by much.
    if (k[0] !== word[0]) continue;
    const d = distance(word, k, max);
    if (d < bestAt) [best, bestAt] = [k, d];
  }
  return best;
}

/** Lower-cased, with emoji, Spanish and French words, and near-misses of the planner's own words read as those words. */
export function normalize(request: string): string {
  let text = String(request ?? '').toLowerCase().replace(/[’]/g, "'");
  for (const [mark, word] of EMOJI) text = text.replace(mark, word);
  text = text.replace(/[\p{L}]+/gu, (w) => FOREIGN[w] ?? nearest(w));
  return text.replace(/\s+/g, ' ').trim();
}
