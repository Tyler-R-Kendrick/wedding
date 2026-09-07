import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export interface MediaRef {
  /** Storage key or file name; the mock hashes it for determinism. */
  objectKey: string;
  contentType?: string;
  /** Optional bytes for adapters that need them (never required by the mock). */
  bytes?: Uint8Array;
}

export interface CaptionResult {
  caption: string;
  /** 0..1 */
  confidence: number;
  model: string;
}

export interface SceneDescription {
  /** Seconds. */
  start: number;
  end: number;
  description: string;
}

/** Coarse setting classes an adapter may return; anything else is normalised to `unknown` by the domain. */
export const MEDIA_AI_VENUE_CLASSES = ['ballroom', 'indoor', 'outdoor', 'garden', 'street', 'lakefront', 'rooftop', 'unknown'] as const;
export type MediaAiVenueClass = (typeof MEDIA_AI_VENUE_CLASSES)[number];

/** One round-trip: caption, alt text, tags and a venue class. All fields are suggestions. */
export interface MediaAnnotation {
  caption: string;
  altText: string;
  tags: string[];
  venueClass: MediaAiVenueClass;
  /** 0..1 */
  confidence: number;
  model: string;
}

/**
 * Non-biometric media understanding (captions, scene descriptions, tags).
 * Output is UNTRUSTED_USER_CONTENT-adjacent: data, never instructions. Adapters only ever
 * receive derivative bytes (metadata-stripped, web-sized); the domain enforces that, and the
 * PRO_MEDIA_AI_PROCESSING gate, before calling.
 */
export interface MediaAiProvider extends ProviderDescriptor {
  kind: 'media-ai';
  caption(media: MediaRef): Promise<Result<CaptionResult, ProviderFailure>>;
  describeScenes(media: MediaRef, opts?: { maxScenes?: number }): Promise<Result<SceneDescription[], ProviderFailure>>;
  tags(media: MediaRef, opts?: { max?: number }): Promise<Result<string[], ProviderFailure>>;
  /** Caption + alt text + tags + venue class in one call (the indexer's entry point). */
  annotate(media: MediaRef): Promise<Result<MediaAnnotation, ProviderFailure>>;
}
