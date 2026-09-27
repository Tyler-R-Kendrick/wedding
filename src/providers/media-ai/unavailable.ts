import type { ConfigValidation, ProviderFailure } from '@/contracts/providers';
import { err, type Result } from '@/contracts/result';
import { failure, unconfiguredHealth } from '../base';
import type { CaptionResult, MediaAiProvider, MediaAnnotation, SceneDescription } from './types';

const REASON = 'no media-ai provider is configured for production; the deterministic mock is refused, so media is indexed from its metadata only';

/**
 * What production gets instead of `MockMediaAi`. The mock's captions are picked from a word list
 * by hashing the object key: fine for fixtures, false for a real guest's photo. Stored as
 * `captionSource: 'ai'`, they would feed search and be offered as alt text. This provider
 * annotates nothing (every capability is false), so the indexer keeps to metadata and the
 * alt-text suggestion stays empty.
 */
export class UnavailableMediaAi implements MediaAiProvider {
  readonly kind = 'media-ai' as const;
  readonly name = 'unconfigured';
  readonly mode = 'unavailable' as const;
  readonly capabilities = { caption: false, describeScenes: false, tags: false, annotate: false };
  validateConfig(): ConfigValidation {
    return { ok: false, missing: [], warnings: [REASON] };
  }
  async health() {
    return unconfiguredHealth(REASON);
  }
  private refuse<T>(): Result<T, ProviderFailure> {
    return err(failure(this.name, 'unconfigured', 'Photo descriptions are not available.'));
  }
  async caption(): Promise<Result<CaptionResult, ProviderFailure>> {
    return this.refuse();
  }
  async describeScenes(): Promise<Result<SceneDescription[], ProviderFailure>> {
    return this.refuse();
  }
  async tags(): Promise<Result<string[], ProviderFailure>> {
    return this.refuse();
  }
  async annotate(): Promise<Result<MediaAnnotation, ProviderFailure>> {
    return this.refuse();
  }
}
