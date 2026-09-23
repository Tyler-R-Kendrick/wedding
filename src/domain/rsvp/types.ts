import type { PlusOnePolicy } from '@/db/schema/events';
import type { RsvpStatus } from '@/db/schema/rsvp';
import type { RsvpWindow } from '@/domain/events/window';
import type { RsvpPart } from './parts';

/** Normalized submission shape. Every field is present (null, never undefined) so hashing is stable. */
export interface RsvpPlusOneInput {
  attending: boolean;
  name: string | null;
  mealOptionId: string | null;
}

export interface RsvpResponseInput {
  guestId: string;
  eventId: string;
  status: RsvpStatus;
  mealOptionId: string | null;
  plusOne: RsvpPlusOneInput | null;
  /**
   * Set by validation, never by a caller: this row answered the plus-one question (so it is stamped
   * `plus_one_answered_at`). Not part of the hashed submission — the schema strips it.
   */
  plusOneAnswered?: boolean;
}

/** SENSITIVE: never logged, never in audit metadata, never in idempotency responses. */
export interface RsvpNeedsInput {
  guestId: string;
  dietary: string | null;
  accessibility: string | null;
}

export interface HouseholdRsvpInput {
  responses: RsvpResponseInput[];
  needs: RsvpNeedsInput[];
}

/**
 * A row as a guest sends it: for any part it is not answering, its fields are ignored and the value
 * on file is kept, so `status` is optional when attendance is not being answered.
 */
export interface RsvpResponseDraft extends Omit<RsvpResponseInput, 'status'> {
  status: RsvpStatus | null;
}

export interface HouseholdRsvpDraft {
  responses: RsvpResponseDraft[];
  needs: RsvpNeedsInput[];
}

/** What is on file for one guest × event, for carrying over the parts a submission does not answer. */
export interface RsvpOnFile {
  status: RsvpStatus;
  mealOptionId: string | null;
  plusOne: RsvpPlusOneInput | null;
}

export interface RsvpValidationContext {
  /** Guests the caller may answer for. Ignored in admin mode (row ownership is checked upstream). */
  actsFor: ReadonlySet<string>;
  entitlements: ReadonlyArray<{ guestId: string; eventId: string; plusOnePolicy: PlusOnePolicy }>;
  events: ReadonlyArray<{ id: string; hasMeal: boolean; mealOptionsVersion: number; rsvpRequired: boolean }>;
  mealOptions: ReadonlyArray<{ id: string; eventId: string; version: number }>;
  window: RsvpWindow;
  /** Admin corrections skip the window and ownership; everything else still applies. */
  mode: 'guest' | 'admin';
  /** The parts this submission answers. Default: all of them (the pre-parts behaviour). */
  parts?: ReadonlySet<RsvpPart>;
  /** Answers on file, keyed `${guestId}::${eventId}`; the source for every part not in `parts`. */
  onFile?: ReadonlyMap<string, RsvpOnFile>;
}

export type RsvpIssueCode = 'forbidden' | 'invalid' | 'closed' | 'stale_meal';

export interface RsvpIssue {
  path: string;
  message: string;
  code: RsvpIssueCode;
}

export type RsvpValidation =
  | { ok: true; value: HouseholdRsvpInput }
  | { ok: false; kind: 'forbidden' | 'closed' | 'validation'; issues: RsvpIssue[] };

export const MAX_NEEDS_CHARS = 500;
export const MAX_PLUS_ONE_NAME_CHARS = 80;
