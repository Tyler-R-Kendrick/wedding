import type { LanguageModel } from 'ai';
import { createExtractiveMockModel, createMockVerifierModel } from '@/providers/ai-model/concierge-mock';
import { getProvider } from '@/providers/registry';

/**
 * Models for the concierge come from the provider registry: the Anthropic adapter when
 * ANTHROPIC_API_KEY is set (never in tests), otherwise the deterministic extractive stand-ins in
 * `src/providers/ai-model/concierge-mock.ts`. The foundation's `MockAiModel` deliberately returns a
 * fixed reply (other swarms depend on that), so the substitution happens here, not in the provider.
 * `live` decides whether the model-based verifier pass runs in addition to the deterministic one.
 */
export interface ConciergeModels {
  chat: LanguageModel;
  verifier: LanguageModel;
  modelId: string;
  live: boolean;
}

export function conciergeModels(): ConciergeModels {
  const provider = getProvider('ai-model');
  if (provider.mode !== 'live') {
    return {
      chat: createExtractiveMockModel(provider.modelIdFor('chat')),
      verifier: createMockVerifierModel(provider.modelIdFor('verifier')),
      modelId: provider.modelIdFor('chat'),
      live: false,
    };
  }
  return { chat: provider.getLanguageModel('chat'), verifier: provider.getLanguageModel('verifier'), modelId: provider.modelIdFor('chat'), live: true };
}
