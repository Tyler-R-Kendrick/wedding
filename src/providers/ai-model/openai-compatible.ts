import type { LanguageModel } from 'ai';
import { okConfig, upHealth } from '../base';
import type { AiModelProvider, ModelRole } from './types';

/**
 * Any provider that speaks the OpenAI chat-completions API: OpenAI itself, and — by pointing
 * `baseURL` elsewhere — OpenRouter, Groq, Together, DeepSeek, xAI, Fireworks, Cerebras,
 * Mistral, or a local Ollama. One adapter rather than one dependency per vendor, which also
 * keeps the fixed package set intact.
 *
 * Roles map to two tiers, as with Anthropic: chat gets the stronger model, verifier and
 * caption the fast one. A provider that names its models differently (OpenRouter prefixes the
 * vendor, `anthropic/claude-sonnet-5`) supplies them through `models`.
 */
export const OPENAI_MODELS: Record<ModelRole, string> = {
  chat: 'gpt-5',
  verifier: 'gpt-5-mini',
  caption: 'gpt-5-mini',
};

type OpenAIProvider = ReturnType<typeof import('@ai-sdk/openai').createOpenAI>;

export type OpenAiCompatibleOptions = {
  apiKey: string;
  /** Omit for OpenAI itself; set for any compatible gateway. */
  baseURL?: string;
  /** Shown in health and provider inventory — "openrouter", "groq", … */
  label?: string;
  /** Per-role model ids, when the vendor does not use OpenAI's names. */
  models?: Partial<Record<ModelRole, string>>;
  createProvider: (options: { apiKey: string; baseURL?: string }) => OpenAIProvider;
};

export class OpenAiCompatibleModel implements AiModelProvider {
  readonly kind = 'ai-model' as const;
  readonly name: string;
  readonly mode = 'live' as const;
  readonly capabilities = { chat: true, verifier: true, caption: true, streaming: true };
  private provider?: OpenAIProvider;
  private readonly models: Record<ModelRole, string>;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.name = options.label ?? 'openai';
    this.models = { ...OPENAI_MODELS, ...options.models };
  }

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth(this.models.chat);
  }
  modelIdFor(role: ModelRole) {
    return this.models[role];
  }
  getLanguageModel(role: ModelRole): LanguageModel {
    this.provider ??= this.options.createProvider({ apiKey: this.options.apiKey, baseURL: this.options.baseURL });
    return this.provider(this.models[role]);
  }
}
