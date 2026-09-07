import { describe, expect, it } from 'vitest';
import { createAiModelProvider } from '@/providers/ai-model';
import type { ServerEnv } from '@/lib/env';

/** Only the fields the factory reads; the rest of ServerEnv is irrelevant here. */
type Env = Parameters<typeof createAiModelProvider>[0];
const env = (over: Partial<Env> = {}): Env =>
  ({ FORCE_MOCK_PROVIDERS: false, ...over }) as Env;

describe('choosing a language-model provider', () => {
  it('falls back to the mock when nothing is configured', () => {
    expect(createAiModelProvider(env()).mode).toBe('mock');
  });

  it('prefers Anthropic, which the site is written against', () => {
    const p = createAiModelProvider(env({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-other' } as Partial<ServerEnv>));
    expect(p.name).toBe('anthropic');
    expect(p.modelIdFor('chat')).toBe('claude-sonnet-5');
  });

  it('honours the mock switch even when keys are present', () => {
    expect(createAiModelProvider(env({ FORCE_MOCK_PROVIDERS: true, ANTHROPIC_API_KEY: 'sk-ant-test' } as Partial<ServerEnv>)).mode).toBe('mock');
  });

  it('uses the OpenAI-compatible adapter when only an OpenAI-style key is set', () => {
    const p = createAiModelProvider(env({ OPENAI_API_KEY: 'sk-test' } as Partial<ServerEnv>));
    expect(p.name).toBe('openai');
    expect(p.modelIdFor('chat')).toBe('gpt-5');
    expect(p.modelIdFor('verifier')).toBe('gpt-5-mini');
  });

  it('points at any gateway through AI_BASE_URL, naming it from the host', () => {
    // This is what makes OpenRouter, Groq, Together, Mistral, DeepSeek and a local Ollama
    // real choices on the Secret Drop page rather than entries the app cannot honour.
    const p = createAiModelProvider(env({
      OPENAI_API_KEY: 'sk-or-v1-test',
      AI_BASE_URL: 'https://openrouter.ai/api/v1',
      AI_CHAT_MODEL: 'anthropic/claude-sonnet-5',
      AI_FAST_MODEL: 'anthropic/claude-haiku-4.5',
    } as Partial<ServerEnv>));
    expect(p.name).toBe('openrouter.ai');
    expect(p.modelIdFor('chat')).toBe('anthropic/claude-sonnet-5');
    expect(p.modelIdFor('caption')).toBe('anthropic/claude-haiku-4.5');
  });

  it('keeps the OpenAI defaults for any tier the gateway does not override', () => {
    const p = createAiModelProvider(env({
      OPENAI_API_KEY: 'gsk_test',
      AI_BASE_URL: 'https://api.groq.com/openai/v1',
      AI_CHAT_MODEL: 'llama-3.3-70b-versatile',
    } as Partial<ServerEnv>));
    expect(p.modelIdFor('chat')).toBe('llama-3.3-70b-versatile');
    expect(p.modelIdFor('verifier')).toBe('gpt-5-mini');
  });

  it('reports live mode and a usable model id for every role', async () => {
    const p = createAiModelProvider(env({ OPENAI_API_KEY: 'sk-test' } as Partial<ServerEnv>));
    expect(p.mode).toBe('live');
    expect(p.validateConfig().ok).toBe(true);
    for (const role of ['chat', 'verifier', 'caption'] as const) {
      expect(p.modelIdFor(role), role).toBeTruthy();
    }
    expect((await p.health()).status).toBe('up');
  });
});

describe('borrowed sessions', () => {
  it('uses an OAuth bearer from a signed-in Claude Code session when no key was issued', () => {
    const p = createAiModelProvider(env({ ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat-test' } as Partial<ServerEnv>));
    expect(p.name).toBe('anthropic (borrowed session)');
    expect(p.mode).toBe('live');
    expect(p.modelIdFor('chat')).toBe('claude-sonnet-5');
  });

  it('prefers a key issued to the site over a borrowed session', () => {
    const p = createAiModelProvider(env({ ANTHROPIC_API_KEY: 'sk-ant-real', ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat' } as Partial<ServerEnv>));
    expect(p.name).toBe('anthropic');
  });

  it('names the harness it borrowed from, so health output says whose identity is answering', () => {
    const p = createAiModelProvider(env({
      OPENAI_API_KEY: 'tid_test',
      AI_BASE_URL: 'https://api.githubcopilot.com',
      AI_HARNESS: 'copilot',
    } as Partial<ServerEnv>));
    expect(p.name).toBe('copilot (borrowed session)');
  });
});
