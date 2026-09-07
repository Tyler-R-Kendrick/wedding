import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ServerEnv } from '@/lib/env';
import { AnthropicAiModel } from './anthropic';
import { MockAiModel } from './mock';
import { OpenAiCompatibleModel } from './openai-compatible';
import type { AiModelProvider } from './types';

export * from './types';
export { MockAiModel, mockLanguageModel, MOCK_REPLY } from './mock';
export { AnthropicAiModel, ANTHROPIC_MODELS } from './anthropic';
export { OpenAiCompatibleModel, OPENAI_MODELS } from './openai-compatible';

type AiModelEnv = Pick<
  ServerEnv,
  | 'FORCE_MOCK_PROVIDERS' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_BASE_URL'
  | 'OPENAI_API_KEY' | 'AI_BASE_URL' | 'AI_CHAT_MODEL' | 'AI_FAST_MODEL' | 'AI_HARNESS'
>;

/**
 * Anthropic when its key is present (what the site is written against), otherwise any
 * OpenAI-compatible provider — OpenAI, OpenRouter, Groq, Together, a local Ollama — selected
 * by pointing AI_BASE_URL at it. Unset, everything falls back to the mock.
 */
export function createAiModelProvider(env: AiModelEnv): AiModelProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockAiModel();
  if (env.ANTHROPIC_API_KEY) {
    return new AnthropicAiModel(
      { apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) },
      (options) => createAnthropic(options),
    );
  }
  // A session borrowed from a signed-in Claude Code CLI — no key was ever issued to the site.
  if (env.ANTHROPIC_AUTH_TOKEN) {
    return new AnthropicAiModel(
      { authToken: env.ANTHROPIC_AUTH_TOKEN, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) },
      (options) => createAnthropic(options),
    );
  }
  if (env.OPENAI_API_KEY) {
    const models = {
      ...(env.AI_CHAT_MODEL ? { chat: env.AI_CHAT_MODEL } : {}),
      ...(env.AI_FAST_MODEL ? { verifier: env.AI_FAST_MODEL, caption: env.AI_FAST_MODEL } : {}),
    };
    return new OpenAiCompatibleModel({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.AI_BASE_URL,
      // The host names the vendor in health output, so an operator can see which one answered.
      label: env.AI_HARNESS ? `${env.AI_HARNESS} (borrowed session)` : env.AI_BASE_URL ? new URL(env.AI_BASE_URL).host : 'openai',
      models,
      createProvider: ({ apiKey, baseURL }) => createOpenAI({ apiKey, baseURL }),
    });
  }
  return new MockAiModel();
}
