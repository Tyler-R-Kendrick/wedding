import type { LanguageModel } from 'ai';
import type { ServerEnv } from '@/lib/env';
import { AnthropicVisionMediaAi } from './anthropic-vision';
import { MockMediaAi } from './mock';
import type { MediaAiProvider } from './types';

export * from './types';
export { MockMediaAi } from './mock';
export { AnthropicVisionMediaAi, parseAnnotationJson, ANNOTATION_PROMPT } from './anthropic-vision';

export interface MediaAiDeps {
  /** Supplies the caption-role language model (the ai-model provider); loaded lazily. */
  languageModel?: () => LanguageModel;
}

/**
 * Mode selection: the Anthropic vision adapter when a key exists (and MEDIA_AI_PROVIDER is not
 * `mock`), else the deterministic mock. Whatever the adapter, callers must honor
 * PRO_MEDIA_AI_PROCESSING: the domain never hands professional media to a live provider without it.
 */
export function createMediaAiProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'ANTHROPIC_API_KEY' | 'MEDIA_AI_PROVIDER'>, deps: MediaAiDeps = {}): MediaAiProvider {
  if (env.FORCE_MOCK_PROVIDERS || env.MEDIA_AI_PROVIDER === 'mock') return new MockMediaAi();
  if (env.ANTHROPIC_API_KEY && deps.languageModel) return new AnthropicVisionMediaAi(deps.languageModel);
  return new MockMediaAi();
}
