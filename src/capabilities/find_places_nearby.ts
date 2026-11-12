import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { DIETS, MEALS, OUTSIDE_KINDS, pickOutside, type OutsidePick, type PlannerPlace } from '@/domain/trip-planner';
import { VENUE_SEARCH_CENTER } from '@/providers/hotels';
import { appServices } from './context';

const input = z.object({
  kinds: z.array(z.enum(OUTSIDE_KINDS)).min(1).max(4),
  diet: z.array(z.enum(DIETS)).max(5).default([]),
  cuisine: z.array(z.string().regex(/^[a-z_]{2,20}$/)).max(4).default([]),
  meal: z.enum(MEALS).optional(),
  limit: z.number().int().min(1).max(8).default(5),
  /** A word in a name that rules a place out ("museum"). */
  notNamed: z.array(z.string().regex(/^[a-z ]{3,20}$/)).max(4).default([]),
  /** Words to put a place whose own name has one first. */
  words: z.array(z.string().regex(/^[a-z]{3,20}$/)).max(8).default([]),
  /** A chain asked for by name. */
  named: z.array(z.string().regex(/^[a-z' -]{3,24}$/)).max(2).default([]),
  notCuisine: z.array(z.string().regex(/^[a-z_]{2,20}$/)).max(8).default([]),
  within: z.number().int().min(100).max(3000).optional(),
  at: z.object({ weekday: z.number().int().min(0).max(6), from: z.number().int().min(0).max(1440), to: z.number().int().min(0).max(2880) }).optional(),
  /** Names of the couple's own places already in the answer, so none is listed twice. */
  ours: z.array(z.string().max(120)).max(60).default([]),
});

const place = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(OUTSIDE_KINDS),
  cuisine: z.array(z.string()),
  diet: z.array(z.enum(DIETS)),
  address: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  website: z.string().optional(),
  hours: z.string().optional(),
  meters: z.number(),
  detail: z.string(),
});
const output = z.object({ places: z.array(place), attribution: z.object({ text: z.string(), href: z.string() }) });
export type FindPlacesNearbyData = z.infer<typeof output>;

const HOTEL = { lat: VENUE_SEARCH_CENTER.latitude, lng: VENUE_SEARCH_CENTER.longitude };

/**
 * Places near the hotel that are not the couple's own recommendations, for the planner to list
 * after theirs. What reaches the search is a kind of place and the hotel's position: never the
 * guest's words, and nothing about the guest. A search that fails is an empty list, not an error.
 */
export const findPlacesNearby = defineCapability<z.input<typeof input>, FindPlacesNearbyData>({
  name: 'find_places_nearby',
  title: 'Find places near the hotel',
  description:
    'Lists restaurants, cafes, bars, museums, parks and playgrounds near the wedding hotel from OpenStreetMap, by kind and optionally by a dietary tag or cuisine. ' +
    "These are not Sara and Tyler's recommendations and must never be presented as theirs. Read only.",
  kind: 'read',
  auth: 'guest',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 8_000,
  async handler(ctx, raw) {
    const i = input.parse(raw);
    const search = appServices(ctx).providers('place-search');
    const found = await search.near({ kinds: i.kinds, at: HOTEL, diet: i.diet }).catch(() => []);
    const ours = i.ours.map((name) => ({ name }) as PlannerPlace);
    const places: OutsidePick[] = pickOutside(
      { kinds: i.kinds, diet: i.diet, cuisine: i.cuisine, ...(i.meal ? { meal: i.meal } : {}), limit: i.limit, notNamed: i.notNamed, words: i.words, named: i.named, notCuisine: i.notCuisine, ...(i.within ? { within: i.within } : {}), ...(i.at ? { at: i.at } : {}) },
      found,
      ours,
      HOTEL,
    );
    return ok({ data: { places, attribution: search.attribution }, sources: [] });
  },
});
