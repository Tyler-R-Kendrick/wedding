import type { ServerEnv } from '@/lib/env';
import { CASH_FUND_DISCLOSURE, parseGiftLinks } from '../registry/links';
import { ConfiguredLinks, MockCashFund } from '../registry/mock';
import type { CashFundProvider } from '../registry/types';

export type { CashFundProvider, GiftLink } from '../registry/types';
export { MockCashFund } from '../registry/mock';

/** Language matters: the couple prefer "help us with our next adventures" over "cash fund" in guest-facing copy. */
export function createCashFundProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'CASH_FUND_LINKS_JSON'>): CashFundProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.CASH_FUND_LINKS_JSON) {
    const { links, rejected } = parseGiftLinks(env.CASH_FUND_LINKS_JSON, CASH_FUND_DISCLOSURE);
    return new ConfiguredLinks('cash-fund', links, rejected);
  }
  return new MockCashFund();
}
