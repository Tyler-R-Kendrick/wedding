import type { FeatureFlag, FlagValues } from '@/contracts/flags';
import type { MediaAssetRow, MediaDerivativeRow, ProfessionalMediaRightsRow } from '@/db/schema/media';
import type { AnnotationSkipReason } from '@/db/schema/media_ai';
import { isServableKey } from '@/lib/media/keys';

/**
 * What the indexer may do with an asset. Pure: the caller supplies flags and readiness.
 *
 *  - Only processed assets (private/published/hidden) are indexed; quarantined, validating,
 *    processing, rejected, failed and deleted assets are never read at all.
 *  - Only DERIVATIVES are ever handed to a provider: the gallery image, or the poster for video.
 *    Originals and quarantine keys can never be selected (asserted with `isServableKey`).
 *  - Professional media (Brooke Alaina Photography, Oakhouse Visuals) reaches a provider only when
 *    PRO_MEDIA_AI_PROCESSING is on, its readiness switch is on, AND the rights row carries the
 *    written-confirmation flag. Otherwise it is indexed from its metadata only (no AI call).
 */
export const INDEXABLE_STATUSES = ['private', 'published', 'hidden'] as const;

export type AiEligibility = { ai: true; derivative: MediaDerivativeRow } | { ai: false; reason: AnnotationSkipReason; derivative?: MediaDerivativeRow };

export interface EligibilityInput {
  asset: Pick<MediaAssetRow, 'status' | 'source' | 'kind' | 'deletedAt'>;
  derivatives: readonly MediaDerivativeRow[];
  rights: Pick<ProfessionalMediaRightsRow, 'allowAiProcessing'> | null;
  flags: Pick<FlagValues, 'MEDIA_SEMANTIC_SEARCH' | 'PRO_MEDIA_AI_PROCESSING'>;
  /** Persisted readiness switch for READINESS_GATED flags; fail closed when absent. */
  readiness: Partial<Record<FeatureFlag, boolean>>;
}

/** The derivative a provider may see: gallery WebP/JPEG for images, poster JPEG for video. Never anything outside derivatives/. */
export function pickAiDerivative(kind: MediaAssetRow['kind'], derivatives: readonly MediaDerivativeRow[]): MediaDerivativeRow | undefined {
  const variant = kind === 'video' ? 'poster' : 'gallery';
  const candidates = derivatives.filter((d) => d.variant === variant && d.metadataStripped && isServableKey(d.key));
  return candidates.find((d) => d.format === 'jpeg') ?? candidates.find((d) => d.format === 'webp') ?? candidates[0];
}

export function isIndexableStatus(status: string): boolean {
  return (INDEXABLE_STATUSES as readonly string[]).includes(status);
}

/** May this professional asset be sent to a third-party AI provider? Flag AND readiness AND written confirmation. */
export function professionalAiAllowed(rights: Pick<ProfessionalMediaRightsRow, 'allowAiProcessing'> | null, flags: Pick<FlagValues, 'PRO_MEDIA_AI_PROCESSING'>, readiness: Partial<Record<FeatureFlag, boolean>>): boolean {
  return flags.PRO_MEDIA_AI_PROCESSING === true && readiness.PRO_MEDIA_AI_PROCESSING === true && rights?.allowAiProcessing === true;
}

export function aiEligibility(input: EligibilityInput): AiEligibility {
  if (input.asset.deletedAt || input.asset.status === 'deleted') return { ai: false, reason: 'deleted' };
  if (!isIndexableStatus(input.asset.status)) return { ai: false, reason: 'not_processed' };
  const derivative = pickAiDerivative(input.asset.kind, input.derivatives);
  if (!derivative) return { ai: false, reason: 'no_derivative' };
  if (!input.flags.MEDIA_SEMANTIC_SEARCH) return { ai: false, reason: 'search_disabled', derivative };
  if (input.asset.source === 'professional' && !professionalAiAllowed(input.rights, input.flags, input.readiness)) {
    return { ai: false, reason: 'pro_media_ai_off', derivative };
  }
  return { ai: true, derivative };
}
