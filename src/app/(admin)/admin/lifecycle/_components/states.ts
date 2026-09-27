import { stateLabel } from '@/domain/lifecycle/words';

// The state labels live with the lifecycle domain, so the gifts setup and the RSVP screen share them.
export { STATE_LABEL, stateLabel } from '@/domain/lifecycle/words';

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
