import { z } from 'zod';
import { INTERESTS } from '@/domain/trip-planner/profile';
import { DIETS, MEALS } from '@/domain/trip-planner/types';

const priceLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const source = z.enum(['rsvp', 'you']).nullable();

/** What a guest sets for the trip planner. Every field has a default, so a partial form still saves. */
export const tripPrefsSchema = z.object({
  diet: z.array(z.enum(DIETS)).max(DIETS.length).nullable().default(null),
  meal: z.enum(MEALS).nullable().default(null),
  budget: priceLevel.nullable().default(null),
  stepFree: z.boolean().nullable().default(null),
  shortWalks: z.boolean().nullable().default(null),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).default([]),
  kids: z.boolean().nullable().default(null),
  asked: z.boolean().default(false),
});

export const tripProfileSchema = z.object({
  party: z.object({ adults: z.number().int(), children: z.number().int() }),
  kids: z.boolean(),
  diet: z.array(z.enum(DIETS)),
  allergy: z.string().nullable(),
  meal: z.enum(MEALS).nullable(),
  budget: priceLevel.nullable(),
  stepFree: z.boolean(),
  shortWalks: z.boolean(),
  interests: z.array(z.enum(INTERESTS)),
  asked: z.boolean(),
  from: z.object({ diet: source, stepFree: source, shortWalks: source, kids: source }),
  saved: z.boolean(),
});
