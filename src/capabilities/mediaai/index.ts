import type { AnyCapability } from '@/contracts/capability';
import '@/domain/mediaai/jobs';
import { adminApplyMediaText } from './admin_apply_media_text';
import { adminMediaAiStatus } from './admin_media_ai_status';
import { adminReindexMedia } from './admin_reindex_media';
import { getMediaClusters } from './get_media_clusters';
import { searchMediaCapability } from './search_media';
import { suggestAltText } from './suggest_alt_text';

/** Swarm I: semantic media intelligence (non-biometric). Importing this module registers the media.index / media.cluster job handlers. */
export const mediaAiCapabilities: readonly AnyCapability[] = [searchMediaCapability, suggestAltText, getMediaClusters, adminApplyMediaText, adminMediaAiStatus, adminReindexMedia];

export { searchMediaCapability, suggestAltText, getMediaClusters, adminApplyMediaText, adminMediaAiStatus, adminReindexMedia };
export type { SearchMediaResult } from './search_media';
export type { AltTextSuggestion } from './suggest_alt_text';
export type { MediaClusters } from './get_media_clusters';
export type { MediaAiStatusView } from './admin_media_ai_status';
export type { SearchHitItem, Suggestion } from './_shared';
