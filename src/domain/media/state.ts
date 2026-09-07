import type { AssetStatus, ModerationAction } from '@/db/schema/media';

/**
 * Asset pipeline state machine (ADR-0005 §4). Pure: no I/O.
 *
 *   quarantined -> validating -> processing -> private -> published <-> hidden
 *   validating | processing -> rejected | failed        failed -> processing (reprocess)
 *   private | published | hidden -> processing (reprocess) | rejected
 *   rejected -> private (restore)      any -> deleted (soft) -> private (restore, admin)
 */
export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  quarantined: ['validating', 'rejected', 'deleted'],
  validating: ['processing', 'rejected', 'failed', 'deleted'],
  processing: ['private', 'failed', 'rejected', 'deleted'],
  private: ['published', 'rejected', 'processing', 'deleted'],
  published: ['hidden', 'rejected', 'processing', 'deleted'],
  hidden: ['published', 'rejected', 'processing', 'deleted'],
  rejected: ['private', 'deleted'],
  failed: ['processing', 'rejected', 'deleted'],
  deleted: ['private'],
};

export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

/** States in which the asset has usable derivatives. */
export const PROCESSED_STATUSES: readonly AssetStatus[] = ['private', 'published', 'hidden', 'rejected'];

/** The only state a gallery ever shows. */
export const isPublished = (status: AssetStatus): boolean => status === 'published';

/** States that still count as "in the pipeline" for the uploader. */
export const isInFlight = (status: AssetStatus): boolean => status === 'quarantined' || status === 'validating' || status === 'processing';

/**
 * Target state of a moderation action from a given state, or null when the action does not apply.
 * `report` is a flag, not a transition: it returns the current state.
 */
export function moderationTarget(action: ModerationAction, from: AssetStatus): AssetStatus | null {
  switch (action) {
    case 'approve':
      return from === 'private' || from === 'hidden' ? 'published' : null;
    case 'reject':
      return from === 'private' || from === 'published' || from === 'hidden' || from === 'failed' ? 'rejected' : null;
    case 'hide':
      return from === 'published' ? 'hidden' : null;
    case 'unhide':
      return from === 'hidden' ? 'published' : null;
    case 'reprocess':
      return from === 'private' || from === 'published' || from === 'hidden' || from === 'failed' ? 'processing' : null;
    case 'delete':
      return from === 'deleted' ? null : 'deleted';
    case 'restore':
      return from === 'rejected' || from === 'deleted' ? 'private' : null;
    case 'report':
      return from === 'deleted' ? null : from;
  }
}

/** Guest-facing wording for an asset's state (never internal jargon). */
export function describeStatus(status: AssetStatus): { label: string; hint: string } {
  switch (status) {
    case 'quarantined':
    case 'validating':
      return { label: 'Checking', hint: 'We are checking the file.' };
    case 'processing':
      return { label: 'Preparing', hint: 'We are preparing web-sized copies.' };
    case 'private':
      return { label: 'Awaiting review', hint: 'Only you can see this until Sara and Tyler approve it.' };
    case 'published':
      return { label: 'Shared', hint: 'Visible to guests in Photos & Video.' };
    case 'hidden':
      return { label: 'Hidden', hint: 'Not shown in the gallery right now.' };
    case 'rejected':
      return { label: 'Not added', hint: 'This one could not be added.' };
    case 'failed':
      return { label: 'Needs another try', hint: 'Processing did not finish. We will retry.' };
    case 'deleted':
      return { label: 'Removed', hint: 'This has been removed.' };
  }
}
