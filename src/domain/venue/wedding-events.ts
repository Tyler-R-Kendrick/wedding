import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { textBlock } from '@/domain/content/text';
import type { ProvenanceViewData, WeddingEventView } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';

/**
 * The Wedding page skeleton. Facts: the date (brief) and what the vendors are contracted to
 * capture (video contract: full ceremony, first dances, toasts; photo contract: through six
 * songs of open dancing). Times, rooms, and dress code are typed placeholders (backlog P-01,
 * P-02, C-01) and render only inside marked placeholder blocks.
 */
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: WEDDING_TIMEZONE });

export function weddingEventSkeleton(provenance: ProvenanceViewData, dateIso: string = WEDDING_DATE_ISO): WeddingEventView[] {
  const weekdayLabel = WEEKDAY.format(new Date(`${dateIso}T12:00:00`));
  const room = textBlock('TODO(Tyler & Sara): which room (White City Ballroom, Madison Ballroom, Stagg Court, or The Tank) is confirmed with the planner (backlog P-01).');
  const dressCode = textBlock('TODO(Tyler & Sara): dress code in one sentence, with an example outfit (backlog C-01).');
  const time = (what: string) => textBlock(`TODO(Tyler & Sara): ${what} time, to be confirmed with the planner (backlog P-02).`);
  return [
    {
      id: 'ceremony',
      name: 'Ceremony',
      dateIso,
      weekdayLabel,
      timeLabel: time('ceremony'),
      room,
      whatHappens: [textBlock('The full ceremony will be filmed and edited by Oakhouse Visuals.'), textBlock('TODO(Tyler & Sara): the ceremony structure, and which community ideas you keep (backlog C-03).')],
      dressCode,
      provenance,
    },
    {
      id: 'cocktail-hour',
      name: 'Cocktail hour',
      dateIso,
      weekdayLabel,
      timeLabel: time('cocktail hour'),
      room,
      whatHappens: [textBlock('TODO(Tyler & Sara): what happens during cocktail hour (food and drink are backlog V-01).')],
      dressCode,
      provenance,
    },
    {
      id: 'reception',
      name: 'Reception',
      dateIso,
      weekdayLabel,
      timeLabel: time('reception'),
      room,
      whatHappens: [textBlock('Dinner, toasts, first dances, and open dancing. The toasts and first dances are filmed; the photographers stay through six songs of open dancing.'), textBlock('TODO(Tyler & Sara): the menu and the music (backlog V-01, C-10).')],
      dressCode,
      provenance,
    },
  ];
}

export const WEDDING_ROUTE = ROUTES.wedding;
