import type { LanguageModel } from 'ai';
import { createExtractiveMockModel, createMockVerifierModel } from '@/providers/ai-model/concierge-mock';
import { getProvider } from '@/providers/registry';

/**
 * The server's models for the concierge, and neither is hosted. An answer is written on the
 * guest's own device (the browser's built-in model through the AI SDK, src/lib/ai/browser-model.ts)
 * and arrives here as a draft to verify; when their browser has no model, `chat` answers by
 * quoting the site's own content (src/providers/ai-model/concierge-mock.ts). Both run in-process:
 * nothing is sent to Anthropic, Vercel's AI Gateway or anyone else, and nothing is billed. The
 * foundation's `MockAiModel` deliberately returns a fixed reply (other swarms depend on that), so
 * the substitution happens here, not in the provider. `live` runs the model-based verifier pass in
 * addition to the deterministic one; only a caller that supplies its own models can turn it on.
 */
export interface ConciergeModels {
  chat: LanguageModel;
  verifier: LanguageModel;
  modelId: string;
  live: boolean;
}

export function conciergeModels(): ConciergeModels {
  const provider = getProvider('ai-model');
  return {
    chat: createExtractiveMockModel(provider.modelIdFor('chat')),
    verifier: createMockVerifierModel(provider.modelIdFor('verifier')),
    modelId: provider.modelIdFor('chat'),
    live: false,
  };
}
