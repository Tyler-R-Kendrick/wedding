import type { AnyCapability } from '@/contracts/capability';
import '@/domain/media/jobs';
import { abortUploadCapability } from './abort_upload';
import { adminImportProfessionalMedia } from './admin_import_professional_media';
import { adminListMedia } from './admin_list_media';
import { adminMediaDuplicates, adminMediaMetrics } from './admin_media_insights';
import { adminModerateMedia } from './admin_moderate_media';
import { completeUploadCapability } from './complete_upload';
import { createUpload } from './create_upload';
import { deleteMyUpload } from './delete_my_upload';
import { getMediaItem } from './get_media_item';
import { listGallery } from './list_gallery';
import { listMyUploads } from './list_my_uploads';
import { resumeUploadCapability } from './resume_upload';

/** Swarm H: media storage, upload, processing, galleries. Importing this module also registers the media job handlers. */
export const mediaCapabilities: readonly AnyCapability[] = [
  createUpload,
  resumeUploadCapability,
  completeUploadCapability,
  abortUploadCapability,
  deleteMyUpload,
  listMyUploads,
  listGallery,
  getMediaItem,
  adminListMedia,
  adminModerateMedia,
  adminImportProfessionalMedia,
  adminMediaDuplicates,
  adminMediaMetrics,
];

export { createUpload, resumeUploadCapability, completeUploadCapability, abortUploadCapability, deleteMyUpload, listMyUploads, listGallery, getMediaItem, adminListMedia, adminModerateMedia, adminImportProfessionalMedia, adminMediaDuplicates, adminMediaMetrics };
export type { GalleryItem, CollectionSummary } from './_shared';
export type { GalleryPage } from './list_gallery';
export type { MediaItemDetail } from './get_media_item';
export type { MyUploadItem } from './list_my_uploads';
export type { QueueItem } from './admin_list_media';
/*
 * Swarm H's own test-principal resolver lived here (`./test-principal`, headers
 * `x-test-principal` + `x-test-auth-secret`) and installed itself with a bare
 * `installTestPrincipalResolver()` call at the bottom of this production barrel. It is deleted.
 *
 * Its doc comment dated it — "before the auth swarm's resolver lands" — and that landed at level
 * 06. This is the third time the same shape has arrived: level 07 moved the injector OUT of a
 * capability barrel precisely because installing a resolver as an import side effect makes the wrap
 * order against the real one depend on module load timing, and level 09 deleted swarm G's
 * cookie-based one for the same reason. Journeys use identity's injector
 * (`src/domain/testing/testPrincipal.ts`), installed once from `src/instrumentation.ts` after the
 * Better Auth resolver, where the ordering is explicit and asserted.
 */
