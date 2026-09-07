import type { AnyCapability } from '@/contracts/capability';
import { askConcierge } from './ask_concierge';
import { listAiTraces } from './list_ai_traces';
import { searchWeddingInformation } from './search_wedding_information';

/**
 * Concierge capabilities (swarm J, ADR-0003). Registered from src/capabilities/index.ts with one
 * line. The concierge itself calls every OTHER AI-exposed capability through `invoke` on surface `ai`.
 */
export const aiCapabilities: readonly AnyCapability[] = [searchWeddingInformation, askConcierge, listAiTraces];

export { searchWeddingInformation, askConcierge, listAiTraces };
