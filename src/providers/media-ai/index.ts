import { MockMediaAi } from './mock';
import type { MediaAiProvider } from './types';

export * from './types';
export { MockMediaAi } from './mock';

/**
 * No photo or video is ever sent to a hosted vision model (the Anthropic adapter is gone). The
 * deterministic stand-in keeps the indexer's contract exercised, and its captions are only ever
 * suggestions for an admin to review. Whatever the adapter, callers must honor
 * PRO_MEDIA_AI_PROCESSING: the domain never hands professional media to a provider without it.
 */
export function createMediaAiProvider(): MediaAiProvider {
  return new MockMediaAi();
}
