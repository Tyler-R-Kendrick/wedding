import { z } from 'zod';
import { RSVP_STATUSES } from '@/db/schema';
import { RSVP_PARTS } from '@/domain/rsvp/parts';
import { MAX_NEEDS_CHARS, MAX_PLUS_ONE_NAME_CHARS } from '@/domain/rsvp/types';
import { idSchema, windowSchema } from './shared';

export const partSchema = z.enum(RSVP_PARTS);
const partsSchema = z.array(partSchema).min(1).max(RSVP_PARTS.length);

/** Lenient draft input: optional fields become null during normalization. */
export const draftInputSchema = z.object({
  /**
   * Which parts of the RSVP this answers: `attendance`, `plusOne`, `meal`, `notes`. Every field of a
   * part not listed is ignored and the answer on file is kept. Default: every part open right now.
   */
  parts: partsSchema.optional(),
  responses: z
    .array(
      z.object({
        guestId: idSchema,
        eventId: idSchema,
        /** Required when answering attendance; ignored otherwise (the answer on file is used). */
        status: z.enum(RSVP_STATUSES).nullable().optional(),
        mealOptionId: z.string().max(64).nullable().optional(),
        plusOne: z.object({ attending: z.boolean(), name: z.string().max(200).nullable().optional(), mealOptionId: z.string().max(64).nullable().optional() }).nullable().optional(),
      }),
    )
    .max(60),
  needs: z.array(z.object({ guestId: idSchema, dietary: z.string().max(2000).nullable().optional(), accessibility: z.string().max(2000).nullable().optional() })).max(30).optional(),
});
export type DraftRsvpInput = z.infer<typeof draftInputSchema>;

/**
 * Strict, fully-normalized submission: exactly what `draft_rsvp` returned, so the payload hash
 * matches the token. Rows are the merged answer (the parts named in `parts` from the guest, the rest
 * from what was on file at draft time); submit re-reads the file for the rest, so an answer someone
 * else in the household saved in between is not overwritten by a stale copy.
 */
export const submitInputSchema = z.object({
  parts: partsSchema,
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
