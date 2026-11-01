import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { textBlock } from '@/domain/content/text';
import type { ProvenanceViewData, WeddingEventView } from '@/domain/content/views';
import { dressCodeShortBlock } from '@/domain/venue/dress-code';
import { ROUTES } from '@/domain/routes';

/**
 * The Wedding page skeleton. Facts: the date (brief), dress code (Tyler 2026-10-31), and what
 * the vendors are contracted to capture (video contract: full ceremony, first dances, toasts;
 * photo contract: through six songs of open dancing). Times and rooms are typed placeholders
 * (backlog P-01, P-02) and render only inside marked placeholder blocks.
 */
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: WEDDING_TIMEZONE });

export function weddingEventSkeleton(provenance: ProvenanceViewData, dateIso: string = WEDDING_DATE_ISO): WeddingEventView[] {
  const weekdayLabel = WEEKDAY.format(new Date(`${dateIso}T12:00:00`));
  const room = textBlock('TODO(Tyler & Sara): which room (White City Ballroom, Madison Ballroom, Stagg Court, or The Tank) is confirmed with the planner (backlog P-01).');
  const dressCode = dressCodeShortBlock();
  const time = (what: string) => textBlock(`TODO(Tyler & Sara): ${what} time, to be confirmed with the planner (backlog P-02).`);
  return [
    {
      id: 'guest-arrival',
      name: 'Guest arrival',
      dateIso,
      weekdayLabel,
      timeLabel: time('guest arrival'),
      room,
      whatHappens: [textBlock('Please arrive 15–30 minutes before the ceremony so you can get settled.')],
      dressCode,
      provenance,
    },
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
    {
      id: 'end-of-celebration',
      name: 'End of celebration',
      dateIso,
      weekdayLabel,
      timeLabel: time('end of celebration'),
      room,
      whatHappens: [textBlock('When the reception ends, we will say goodnight from the dance floor.')],
      dressCode,
      provenance,
    },
  ];
}

export const WEDDING_ROUTE = ROUTES.wedding;
