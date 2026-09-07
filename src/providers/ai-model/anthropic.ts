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

/**
 * Either a console API key, or an OAuth bearer borrowed from a signed-in Claude Code session.
 * The two travel in different headers, so the caller says which it has.
 */
export type AnthropicCredential =
  | { apiKey: string; authToken?: undefined; baseURL?: string }
  | { authToken: string; apiKey?: undefined; baseURL?: string };

export class AnthropicAiModel implements AiModelProvider {
  readonly kind = 'ai-model' as const;
  readonly name: string;
  readonly mode = 'live' as const;
  readonly capabilities = { chat: true, verifier: true, caption: true, streaming: true };
  private provider?: AnthropicProvider;

  constructor(
    private readonly credential: AnthropicCredential,
    private readonly createProvider: (options: { apiKey: string; baseURL?: string; headers?: Record<string, string> }) => AnthropicProvider,
  ) {
    this.name = credential.authToken ? 'anthropic (borrowed session)' : 'anthropic';
  }

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
    // A local binding lets the union narrow; `this.credential.x` does not discriminate.
    const credential = this.credential;
    const baseURL = credential.baseURL ? { baseURL: credential.baseURL } : {};
    this.provider ??= this.createProvider(
      credential.authToken !== undefined
        // The SDK always sends x-api-key; a placeholder keeps it happy while the bearer does the work.
        ? { apiKey: 'oauth', headers: { authorization: `Bearer ${credential.authToken}` }, ...baseURL }
        : { apiKey: credential.apiKey, ...baseURL },
    );
    return this.provider(ANTHROPIC_MODELS[role]);
  }
}
