import { MockRegistry } from './mock';
import type { RegistryProvider } from './types';

export * from './types';
export { parseGiftLinks, REGISTRY_DISCLOSURE, CASH_FUND_DISCLOSURE } from './links';
export { MockRegistry, MockCashFund, ConfiguredLinks, MOCK_REGISTRY_LINKS, MOCK_CASH_FUND_LINKS } from './mock';

export function createRegistryProvider(): RegistryProvider {
  /*
   * Gift links live in the `gift_links` table and are edited in /admin/gifts, which validates
   * every URL against the redirect allowlist at write time and again at read time. This used to
   * take a hand-maintained JSON blob from the environment as a second source, which only ever
   * applied when the admin table was empty — so it was a way for the couple to maintain the same
   * data twice, in the format least suited to it. The provider now only supplies the built-in
   * placeholders that `listGiftLinks` falls back to when nothing has been configured yet.
   */
  return new MockRegistry();
}
