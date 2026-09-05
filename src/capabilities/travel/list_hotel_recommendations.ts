import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { AIRPORTS, BRIEF_CITATION, CAA_KIT_CITATION, CAA_SITE_CITATION, hotelRecommendationOutput, listHotels, VENUE } from '@/domain/travel';
import { airportOutput, travelServices } from './_shared';

const input = z.object({}).optional();
const output = z.object({
  /** The venue hotel with its room block; `block.placeholder` is true until the planner supplies the details. */
  venue: hotelRecommendationOutput,
  /** Curated alternatives with the couple’s objective reasons (walk time, staffed desk, family suites, price band, accessible route, transit). */
  alternatives: z.array(hotelRecommendationOutput),
  facts: z.object({
    venue: z.object({ name: z.string(), address: z.string(), url: z.string(), faqUrl: z.string(), valetEntrance: z.string(), valetNote: z.string() }),
    airports: z.array(airportOutput),
  }),
});

export const listHotelRecommendations = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'list_hotel_recommendations',
  title: 'Where to stay',
  description:
    'Lists where to stay for the wedding: the Chicago Athletic Association Hotel room block first (link, rate, dates and cutoff appear only once the planner confirms them; until then the record says so), ' +
    'then the couple’s hand-picked alternatives with their reasons and any price band. It states no prices of its own and makes no safety claims. Use search_travel_options for live rates.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx) {
    const { db } = travelServices(ctx);
    const hotels = await listHotels(db, { now: ctx.now });
    const venue = hotels.find((h) => h.isVenue)!;
    return ok({
      data: {
        venue,
        alternatives: hotels.filter((h) => !h.isVenue),
        facts: { venue: { name: VENUE.name, address: VENUE.address, url: VENUE.url, faqUrl: VENUE.faqUrl, valetEntrance: VENUE.valetEntrance, valetNote: VENUE.valetNote }, airports: AIRPORTS.map((a) => ({ ...a })) },
      },
      sources: [CAA_KIT_CITATION, CAA_SITE_CITATION, BRIEF_CITATION],
    });
  },
});
