import { env as serverEnv, type ServerEnv } from '@/lib/env';
import { MockMediaAi } from './mock';
import type { MediaAiProvider } from './types';
import { UnavailableMediaAi } from './unavailable';

export * from './types';
export { MockMediaAi } from './mock';
export { UnavailableMediaAi } from './unavailable';

type MediaAiEnv = Partial<Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'isProduction'>>;

/**
 * No photo or video is ever sent to a hosted vision model (the Anthropic adapter is gone). The
 * deterministic stand-in keeps the indexer's contract exercised in development and tests, and its
 * captions are only ever suggestions for an admin to review. In production (unless
 * FORCE_MOCK_PROVIDERS pins the mocks) it is refused: its word-list captions would be stored as
 * AI descriptions of real guests' photos, so production gets `UnavailableMediaAi` and the indexer
 * works from metadata only. Whatever the adapter, callers must honor PRO_MEDIA_AI_PROCESSING: the
 * domain never hands professional media to a provider without it. The registry passes no env, so
 * the validated server environment is the default.
 */
export function createMediaAiProvider(env: MediaAiEnv = serverEnv): MediaAiProvider {
  if (env.isProduction && !env.FORCE_MOCK_PROVIDERS) return new UnavailableMediaAi();
  return new MockMediaAi();
}
