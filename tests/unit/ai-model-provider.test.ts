import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { generateText } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { conciergeModels } from '@/ai/model';
import { refuseHostedModels } from '@/lib/ai/no-hosted-models';
import { createAiModelProvider } from '@/providers/ai-model';
import { createEmbeddingsProvider } from '@/providers/embeddings';
import { createMediaAiProvider } from '@/providers/media-ai';
import { resetProviders } from '@/providers/registry';

/**
 * Guest Q&A runs on the guest's own device (the W3C Prompt API); the server only retrieves,
 * verifies and, for a browser with no model, quotes the site's own content. No hosted model is
 * reachable from the server at all: not Anthropic, not Vercel's AI Gateway, not an OpenAI-style
 * endpoint. The factories take no configuration, so a key left in the environment selects nothing.
 */
describe('the server never uses a hosted AI provider', () => {
  afterEach(() => resetProviders());

  it('builds only in-process models', () => {
    for (const p of [createAiModelProvider(), createEmbeddingsProvider(), createMediaAiProvider()]) {
      expect(p.mode, p.kind).toBe('mock');
    }
    const models = conciergeModels();
    expect(models.live).toBe(false);
    for (const m of [models.chat, models.verifier]) {
      expect(typeof m === 'string' ? m : m.provider).toBe('mock');
    }
  });

  it('refuses a model named by a string, which the AI SDK would otherwise send to the AI Gateway', async () => {
    const previous = globalThis.AI_SDK_DEFAULT_PROVIDER;
    refuseHostedModels();
    try {
      await expect(generateText({ model: 'anthropic/claude-sonnet-5', prompt: 'hello' })).rejects.toThrow(/No such languageModel/i);
    } finally {
      globalThis.AI_SDK_DEFAULT_PROVIDER = previous;
    }
  });

  it('ships no hosted AI SDK and names no hosted model anywhere in the app', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    // `@ai-sdk/provider` is the model specification (types only); every other package is a vendor.
    const vendor = (name: string) => /^@ai-sdk\/(?!provider(-utils)?$)/.test(name);
    expect(deps.filter(vendor)).toEqual([]);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(file);
      }
    };
    walk('src');
    const offending = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        /from ['"]@ai-sdk\/(?!provider(-utils)?['"])/.test(text) ||
        /\b(createGateway|createAnthropic|createOpenAI|createVoyage)\b/.test(text) ||
        /import\s*\{[^}]*\bgateway\b[^}]*\}\s*from\s*['"]ai['"]/.test(text) ||
        // A "vendor/model" string is resolved through the AI Gateway (see no-hosted-models.ts).
        /\bmodel:\s*['"`][\w.-]+\/[\w.-]+['"`]/.test(text)
      );
    });
    expect(offending).toEqual([]);
  });
});
