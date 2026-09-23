import type { DraftRsvpOutput, SubmitRsvpInput, SubmitRsvpOutput } from '@/capabilities/rsvp';

type SubmittedRow = SubmitRsvpInput['responses'][number];

/** What the guest last entered. A row from a page that does not ask attendance has no status. */
export interface RsvpFormValues {
  responses: Array<Omit<SubmittedRow, 'status'> & { status: SubmittedRow['status'] | null }>;
  needs: SubmitRsvpInput['needs'];
}

export type RsvpFormState =
  | {
      stage: 'form';
      /** Field-level errors keyed by input name (see fieldNames in RsvpForm). */
      errors: Record<string, string>;
      /** Non-field messages (closed window, expired review, backend trouble). */
      messages: string[];
      /** Previously entered values to re-fill the form with. */
      values: RsvpFormValues | null;
      failure: boolean;
    }
  | { stage: 'review'; proposal: DraftRsvpOutput['proposal']; submission: SubmitRsvpInput; token: string; expiresAt: string; idempotencyKey: string; editableUntil: string | null }
  | { stage: 'done'; result: SubmitRsvpOutput };

export const INITIAL_RSVP_STATE: RsvpFormState = { stage: 'form', errors: {}, messages: [], values: null, failure: false };

export const fieldNames = {
  status: (g: string, e: string) => `status:${g}:${e}`,
  meal: (g: string, e: string) => `meal:${g}:${e}`,
  plusOne: (g: string, e: string) => `p1:${g}:${e}`,
  plusOneName: (g: string, e: string) => `p1name:${g}:${e}`,
  plusOneMeal: (g: string, e: string) => `p1meal:${g}:${e}`,
  dietary: (g: string) => `dietary:${g}`,
  accessibility: (g: string) => `accessibility:${g}`,
} as const;
