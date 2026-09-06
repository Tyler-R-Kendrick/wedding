import { MockMediaAi } from './mock';
import type { MediaAiProvider } from './types';

export * from './types';
export { MockMediaAi } from './mock';

/** Mock only at level 03. A vision adapter belongs to the media swarm and must honor PRO_MEDIA_AI_PROCESSING. */
export function createMediaAiProvider(): MediaAiProvider {
  return new MockMediaAi();
}
