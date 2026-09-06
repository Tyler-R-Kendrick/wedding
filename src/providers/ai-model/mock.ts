import { MockLanguageModelV4 } from 'ai/test';
import { okConfig, upHealth } from '../base';
import type { AiModelProvider, ModelRole } from './types';

export const MOCK_REPLY = 'This is the mock concierge. Configure ANTHROPIC_API_KEY to talk to a real model.';

/** Deterministic stub model from `ai/test`; answers every prompt with MOCK_REPLY. */
export function mockLanguageModel(modelId: string, reply: string = MOCK_REPLY): MockLanguageModelV4 {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId,
    doGenerate: async () => ({
      content: [{ type: 'text', text: reply }],
      finishReason: { unified: 'stop', raw: undefined },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't1' });
          controller.enqueue({ type: 'text-delta', id: 't1', delta: reply });
          controller.enqueue({ type: 'text-end', id: 't1' });
          controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage });
          controller.close();
        },
      }),
    }),
  });
}

export class MockAiModel implements AiModelProvider {
  readonly kind = 'ai-model' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { chat: true, verifier: true, caption: true, streaming: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  modelIdFor(role: ModelRole) {
    return `mock-${role}`;
  }
  getLanguageModel(role: ModelRole) {
    return mockLanguageModel(this.modelIdFor(role));
  }
}
