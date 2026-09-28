import type { LifecycleState } from '@/contracts/lifecycle';

/**
 * The lifecycle in words, in one place. The codes (`RSVP_OPEN`) are the model's names and belong in
 * Technical details; everywhere a person reads the state, it is one of these.
 */

/** The state as a label: the lifecycle screen, the RSVP screen's "why replies are closed". */
export const STATE_LABEL: Readonly<Record<LifecycleState, string>> = {
  TEASER: 'Teaser',
  SAVE_THE_DATE: 'Save the date',
  INVITATIONS_OPEN: 'Invitations out',
  RSVP_OPEN: 'RSVPs open',
  RSVP_CLOSED: 'RSVPs closed',
  WEDDING_WEEK: 'Wedding week',
  WEDDING_DAY: 'Wedding day',
  POST_WEDDING: 'After the wedding',
  ARCHIVE: 'Archive',
};

/** The state inside a sentence an admin reads: "The site is at the teaser now." */
export const STATE_IN_SENTENCE: Readonly<Record<LifecycleState, string>> = {
  TEASER: 'the teaser',
  SAVE_THE_DATE: 'save the date',
  INVITATIONS_OPEN: 'invitations out',
  RSVP_OPEN: 'RSVPs open',
  RSVP_CLOSED: 'RSVPs closed',
  WEDDING_WEEK: 'wedding week',
  WEDDING_DAY: 'the wedding day',
  POST_WEDDING: 'after the wedding',
  ARCHIVE: 'the archive',
};

/** A state code as a label; an unknown value is shown as it stands (it is the evidence). */
export const stateLabel = (s: string | null | undefined): string => (s ? (STATE_LABEL[s as LifecycleState] ?? s) : '—');
