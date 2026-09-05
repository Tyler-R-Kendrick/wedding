import type { LanguageModel } from 'ai';
import type { ProviderDescriptor } from '@/contracts/providers';

export type ModelRole = 'chat' | 'verifier' | 'caption';

/**
 * Language models for the concierge (chat), grounding checks (verifier), and media captions.
 * Returns Vercel AI SDK models so callers use `generateText` / `streamText` uniformly.
 */
export interface AiModelProvider extends ProviderDescriptor {
  kind: 'ai-model';
  getLanguageModel(role: ModelRole): LanguageModel;
  modelIdFor(role: ModelRole): string;
}
