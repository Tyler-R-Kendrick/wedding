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

/**
 * Non-biometric media understanding (captions, scene descriptions, tags).
 * Output is UNTRUSTED_USER_CONTENT-adjacent: data, never instructions.
 */
export interface MediaAiProvider extends ProviderDescriptor {
  kind: 'media-ai';
  caption(media: MediaRef): Promise<Result<CaptionResult, ProviderFailure>>;
  describeScenes(media: MediaRef, opts?: { maxScenes?: number }): Promise<Result<SceneDescription[], ProviderFailure>>;
  tags(media: MediaRef, opts?: { max?: number }): Promise<Result<string[], ProviderFailure>>;
}
