import type { LifecycleState } from '@/contracts/lifecycle';

/**
 * The lifecycle in words. The codes (`RSVP_OPEN`) are the model's names and belong in Technical
 * details; everywhere a person reads the state, it is one of these. The RSVP screen uses the same
 * map to say why replies are closed.
 */
export const STATE_LABEL: Record<LifecycleState, string> = {
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

/** What the home page leads with in each mode (`LIFECYCLE_MODE`). */
export const MODE_LABEL: Record<string, string> = {
  explore: 'The story and the details',
  act: 'Invitations and replies',
  operate: 'The schedule and getting there',
  remember: 'Photos and thanks',
};

export const DIRECTION_LABEL: Record<string, string> = {
  forward: 'Forward',
  back: 'Back one step (undo)',
};

export const OUTCOME_LABEL: Record<string, string> = {
  success: 'Done',
  denied: 'Refused',
  failed: 'Failed',
};

/** A state code in words; an unknown value is shown as it stands (it is the evidence). */
export const stateLabel = (s: string | null | undefined): string => (s ? (STATE_LABEL[s as LifecycleState] ?? s) : '—');

/** Who did it, without the internal id (that is in Technical details). */
export const actorLabel = (a: { kind: string; ref: string | null } | null | undefined): string => {
  if (!a) return '—';
  if (a.kind === 'admin') return 'An administrator';
  if (a.kind === 'system') return a.ref === 'seed' ? 'Set when the site was created' : 'The site, automatically';
  if (a.kind === 'guest') return 'A guest';
  return 'Someone else';
};

/** One history row's change, in a sentence: "Save the date to RSVPs open", "Previewed Wedding day". */
export const changeLabel = (action: string, metadata: Record<string, string> | null): string => {
  if (action === 'lifecycle.published') {
    return metadata?.from && metadata?.to ? `Published: ${stateLabel(metadata.from)} to ${stateLabel(metadata.to)}` : 'Published a state';
  }
  if (action === 'lifecycle.previewed') return metadata?.state ? `Previewed ${stateLabel(metadata.state)}` : 'Previewed a state';
  return 'Other change';
};
