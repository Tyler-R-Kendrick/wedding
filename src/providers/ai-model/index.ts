import { createAnthropic } from '@ai-sdk/anthropic';
import type { ServerEnv } from '@/lib/env';
import { AnthropicAiModel } from './anthropic';
import { MockAiModel } from './mock';
import type { AiModelProvider } from './types';

export * from './types';
export { MockAiModel, mockLanguageModel, MOCK_REPLY } from './mock';
export { AnthropicAiModel, ANTHROPIC_MODELS } from './anthropic';
// Level 12: a deterministic extractive stand-in for the concierge. MockAiModel's fixed MOCK_REPLY
// is asserted on by earlier levels, so the concierge gets its own mock rather than changing that.
export { createExtractiveMockModel, createMockVerifierModel, extractiveAnswer, extractiveVerdicts, parseBlocks, NO_SOURCE } from './concierge-mock';

export function createAiModelProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'ANTHROPIC_API_KEY'>): AiModelProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.ANTHROPIC_API_KEY) {
    return new AnthropicAiModel(env.ANTHROPIC_API_KEY, (apiKey) => createAnthropic({ apiKey }));
  }
  return new MockAiModel();
}
