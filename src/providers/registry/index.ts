import type { ServerEnv } from '@/lib/env';
import { parseGiftLinks, REGISTRY_DISCLOSURE } from './links';
import { ConfiguredLinks, MockRegistry } from './mock';
import type { RegistryProvider } from './types';

export * from './types';
export { parseGiftLinks, REGISTRY_DISCLOSURE, CASH_FUND_DISCLOSURE } from './links';
export { MockRegistry, MockCashFund, ConfiguredLinks, MOCK_REGISTRY_LINKS, MOCK_CASH_FUND_LINKS } from './mock';

export function createRegistryProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'REGISTRY_LINKS_JSON'>): RegistryProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.REGISTRY_LINKS_JSON) {
    const { links, rejected } = parseGiftLinks(env.REGISTRY_LINKS_JSON, REGISTRY_DISCLOSURE);
    return new ConfiguredLinks('registry', links, rejected);
  }
  return new MockRegistry();
}
