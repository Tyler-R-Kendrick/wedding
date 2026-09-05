import { z } from 'zod';
import { RSVP_STATUSES } from '@/db/schema';
import { MAX_NEEDS_CHARS, MAX_PLUS_ONE_NAME_CHARS } from '@/domain/rsvp/types';
import { idSchema, windowSchema } from './shared';

/** Lenient draft input: optional fields become null during normalization. */
export const draftInputSchema = z.object({
  responses: z
    .array(
      z.object({
        guestId: idSchema,
        eventId: idSchema,
        status: z.enum(RSVP_STATUSES),
        mealOptionId: z.string().max(64).nullable().optional(),
        plusOne: z.object({ attending: z.boolean(), name: z.string().max(200).nullable().optional(), mealOptionId: z.string().max(64).nullable().optional() }).nullable().optional(),
      }),
    )
    .max(60),
  needs: z.array(z.object({ guestId: idSchema, dietary: z.string().max(2000).nullable().optional(), accessibility: z.string().max(2000).nullable().optional() })).max(30).optional(),
});
export type DraftRsvpInput = z.infer<typeof draftInputSchema>;

/** Strict, fully-normalized submission: exactly what `draft_rsvp` returned, so the payload hash matches the token. */
export const submitInputSchema = z.object({
  responses: z
    .array(
      z.object({
        guestId: idSchema,
        eventId: idSchema,
        status: z.enum(RSVP_STATUSES),
        mealOptionId: z.string().max(64).nullable(),
        plusOne: z.object({ attending: z.boolean(), name: z.string().max(MAX_PLUS_ONE_NAME_CHARS).nullable(), mealOptionId: z.string().max(64).nullable() }).nullable(),
      }),
    )
    .min(1)
    .max(60),
  needs: z.array(z.object({ guestId: idSchema, dietary: z.string().max(MAX_NEEDS_CHARS).nullable(), accessibility: z.string().max(MAX_NEEDS_CHARS).nullable() })).max(30),
});
export type SubmitRsvpInput = z.infer<typeof submitInputSchema>;

export const proposalLineSchema = z.object({
  guestId: z.string(),
  guestName: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  status: z.enum(RSVP_STATUSES),
  mealLabel: z.string().nullable(),
  plusOne: z.object({ attending: z.boolean(), name: z.string().nullable(), mealLabel: z.string().nullable() }).nullable(),
});

export const proposalSchema = z.object({ lines: z.array(proposalLineSchema), needsRecordedFor: z.array(z.string()), summary: z.string() });

export const submitOutputSchema = z.object({
  submittedAt: z.string(),
  householdId: z.string(),
  lines: z.array(proposalLineSchema),
  needsRecordedFor: z.array(z.string()),
  /** True when a confirmation e-mail was queued for the submitting guest. */
  emailQueued: z.boolean(),
  window: windowSchema,
  editableUntil: z.string().nullable(),
});
export type SubmitRsvpOutput = z.infer<typeof submitOutputSchema>;
