import type { LanguageModel } from 'ai';
import { getProvider } from '@/providers/registry';

/**
 * Models for the concierge come from the provider registry: the Anthropic adapter when
 * ANTHROPIC_API_KEY is set (never in tests), otherwise the deterministic mocks. `live` decides
 * whether the model-based verifier pass runs in addition to the deterministic one.
 */
export interface ConciergeModels {
  chat: LanguageModel;
  verifier: LanguageModel;
  modelId: string;
  live: boolean;
}

export function conciergeModels(): ConciergeModels {
  const provider = getProvider('ai-model');
  return { chat: provider.getLanguageModel('chat'), verifier: provider.getLanguageModel('verifier'), modelId: provider.modelIdFor('chat'), live: provider.mode === 'live' };
}
