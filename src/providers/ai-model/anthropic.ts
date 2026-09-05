import type { LanguageModel } from 'ai';
import { okConfig, upHealth } from '../base';
import type { AiModelProvider, ModelRole } from './types';

/** Model ids per role. Chat gets the stronger model; verifier/caption run on the fast tier. */
export const ANTHROPIC_MODELS: Record<ModelRole, string> = {
  chat: 'claude-sonnet-5',
  verifier: 'claude-haiku-4-5',
  caption: 'claude-haiku-4-5',
};

type AnthropicProvider = ReturnType<typeof import('@ai-sdk/anthropic').createAnthropic>;

export class AnthropicAiModel implements AiModelProvider {
  readonly kind = 'ai-model' as const;
  readonly name = 'anthropic';
  readonly mode = 'live' as const;
  readonly capabilities = { chat: true, verifier: true, caption: true, streaming: true };
  private provider?: AnthropicProvider;

  constructor(private readonly apiKey: string, private readonly createProvider: (apiKey: string) => AnthropicProvider) {}

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth(ANTHROPIC_MODELS.chat);
  }
  modelIdFor(role: ModelRole) {
    return ANTHROPIC_MODELS[role];
  }
  getLanguageModel(role: ModelRole): LanguageModel {
    this.provider ??= this.createProvider(this.apiKey);
    return this.provider(ANTHROPIC_MODELS[role]);
  }
}
