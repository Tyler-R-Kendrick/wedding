import { MockAiModel } from './mock';
import type { AiModelProvider } from './types';

export * from './types';
export { MockAiModel, mockLanguageModel, MOCK_REPLY } from './mock';
// Level 12: a deterministic extractive stand-in for the concierge. MockAiModel's fixed MOCK_REPLY
// is asserted on by earlier levels, so the concierge gets its own mock rather than changing that.
export { createExtractiveMockModel, createMockVerifierModel, extractiveAnswer, extractiveVerdicts, parseBlocks, NO_SOURCE } from './concierge-mock';

/**
 * The server never calls a hosted language model: not Anthropic, not Vercel's AI Gateway, not an
 * OpenAI-compatible endpoint, whatever keys the environment happens to hold. The concierge is
 * written on the guest's own device (the browser's built-in model through the AI SDK,
 * src/lib/ai/browser-model.ts) and only verified here; a browser without a model gets an answer
 * quoted from the site's own content (src/ai/model.ts). Nothing is billed and no key exists to
 * leak, so there is nothing to select.
 */
export function createAiModelProvider(): AiModelProvider {
  return new MockAiModel();
}
