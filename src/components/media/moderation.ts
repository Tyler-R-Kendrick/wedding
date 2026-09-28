import type { AssetStatus, ModerationAction } from '@/db/schema/media';

/*
 * The admin's words for media states and moderation actions, shared by the queue (a client island)
 * and the server pages around it (the queue's filter, storage counts). A plain module, not the
 * client component's, so a server component reads the values rather than a client reference.
 */

/** What each action is called on its button. "Approve and publish: 4 done." is what the queue says afterwards. */
export const ACTION_LABEL: Record<ModerationAction, string> = {
  approve: 'Approve and publish',
  reject: 'Reject',
  hide: 'Hide from the gallery',
  unhide: 'Show in the gallery again',
  report: 'Flag for follow-up',
  reprocess: 'Prepare again',
  delete: 'Delete',
  restore: 'Restore to the queue',
};

/** The admin's words for a state. The raw value is still the filter's `status=` in the URL. */
export const STATUS_LABEL: Record<AssetStatus, string> = {
  quarantined: 'Quarantined',
  validating: 'Checking',
  processing: 'Preparing',
  private: 'Awaiting review',
  published: 'Published',
  hidden: 'Hidden',
  rejected: 'Rejected',
  failed: 'Failed',
  deleted: 'Deleted',
};
