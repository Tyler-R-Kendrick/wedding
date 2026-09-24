import { customProvider } from 'ai';

/**
 * Closes the one door to a hosted model that needs no key at all.
 *
 * The AI SDK resolves a model named by a plain string ("anthropic/claude-sonnet-5") through Vercel's
 * AI Gateway unless a default provider says otherwise, and on Vercel the gateway signs with the
 * deployment's own OIDC token. So one string model id anywhere on the server would be answered, and
 * billed, with no key configured anywhere. This installs a default provider that knows no models:
 * such a call throws NoSuchModelError on the spot and nothing leaves the server. Models the site
 * does use are passed as objects (src/ai/model.ts) and never consult the default.
 */
export function refuseHostedModels(): void {
  globalThis.AI_SDK_DEFAULT_PROVIDER = customProvider({});
}
