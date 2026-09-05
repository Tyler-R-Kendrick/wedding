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
import { installTestPrincipalResolver } from './test-principal';

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
export { installTestPrincipalResolver, resolveTestPrincipal, isTestPrincipalEnabled, TEST_PRINCIPAL_HEADER, TEST_AUTH_SECRET_HEADER } from './test-principal';

// Test journeys act as guests/admins through the injector; it is inert outside NODE_ENV=test.
installTestPrincipalResolver();
