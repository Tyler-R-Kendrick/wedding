import type { PlusOnePolicy } from '@/db/schema/events';
import type { RsvpStatus } from '@/db/schema/rsvp';
import type { RsvpWindow } from '@/domain/events/window';

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

export interface RsvpValidationContext {
  /** Guests the caller may answer for. Ignored in admin mode (row ownership is checked upstream). */
  actsFor: ReadonlySet<string>;
  entitlements: ReadonlyArray<{ guestId: string; eventId: string; plusOnePolicy: PlusOnePolicy }>;
  events: ReadonlyArray<{ id: string; hasMeal: boolean; mealOptionsVersion: number; rsvpRequired: boolean }>;
  mealOptions: ReadonlyArray<{ id: string; eventId: string; version: number }>;
  window: RsvpWindow;
  /** Admin corrections skip the window and ownership; everything else still applies. */
  mode: 'guest' | 'admin';
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
