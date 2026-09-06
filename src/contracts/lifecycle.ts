/**
 * Site lifecycle. Manual publish state always beats the wall clock; automatic
 * transitions are suggestions the admin can accept, and previews never change
 * production state.
 */
export const LIFECYCLE_STATES = [
  'TEASER',
  'SAVE_THE_DATE',
  'INVITATIONS_OPEN',
  'RSVP_OPEN',
  'RSVP_CLOSED',
  'WEDDING_WEEK',
  'WEDDING_DAY',
  'POST_WEDDING',
  'ARCHIVE',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_ORDER: Record<LifecycleState, number> = Object.fromEntries(
  LIFECYCLE_STATES.map((s, i) => [s, i]),
) as Record<LifecycleState, number>;

/** Allowed manual transitions: forward by one or more, or back by one (undo). */
export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  const a = LIFECYCLE_ORDER[from];
  const b = LIFECYCLE_ORDER[to];
  return b > a || b === a - 1;
}

export const WEDDING_DATE_ISO = '2027-07-17';
export const WEDDING_TIMEZONE = 'America/Chicago';

/**
 * Suggested state from the calendar, in the wedding's time zone. Only used to
 * propose a transition to admins and for previews; never applied automatically.
 */
export function suggestedStateFor(now: Date, weddingDateIso: string = WEDDING_DATE_ISO): LifecycleState {
  const chicago = new Date(now.toLocaleString('en-US', { timeZone: WEDDING_TIMEZONE }));
  // Compare calendar days, not instants: any time on the wedding day is WEDDING_DAY.
  const today = new Date(chicago.getFullYear(), chicago.getMonth(), chicago.getDate());
  const wedding = new Date(`${weddingDateIso}T00:00:00`);
  const days = Math.round((wedding.getTime() - today.getTime()) / 86_400_000);
  if (days < -30) return 'ARCHIVE';
  if (days < 0) return 'POST_WEDDING';
  if (days === 0) return 'WEDDING_DAY';
  if (days <= 7) return 'WEDDING_WEEK';
  return 'RSVP_OPEN';
}

/** What the home page prioritizes in each state (used by page recipes). */
export const LIFECYCLE_MODE: Record<LifecycleState, 'explore' | 'act' | 'operate' | 'remember'> = {
  TEASER: 'explore',
  SAVE_THE_DATE: 'explore',
  INVITATIONS_OPEN: 'act',
  RSVP_OPEN: 'act',
  RSVP_CLOSED: 'act',
  WEDDING_WEEK: 'operate',
  WEDDING_DAY: 'operate',
  POST_WEDDING: 'remember',
  ARCHIVE: 'remember',
};
