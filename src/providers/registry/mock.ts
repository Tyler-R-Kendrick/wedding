import { okConfig, upHealth } from '../base';
import { CASH_FUND_DISCLOSURE, REGISTRY_DISCLOSURE } from './links';
import type { CashFundProvider, GiftLink, RegistryProvider } from './types';

/** Placeholders only: real links come from the couple (TODO(Tyler & Sara)). */
export const MOCK_REGISTRY_LINKS: GiftLink[] = [
  {
    id: 'registry-placeholder',
    provider: 'zola',
    label: 'TODO(Tyler & Sara): registry link',
    note: 'Physical wishlist',
    url: 'https://www.zola.com/',
    opensNewTab: true,
    disclosure: REGISTRY_DISCLOSURE,
  },
];

export const MOCK_CASH_FUND_LINKS: GiftLink[] = [
  {
    id: 'adventure-fund-placeholder',
    provider: 'zola',
    label: 'TODO(Tyler & Sara): help us with our next adventures',
    note: 'Experience gifts and gift cards',
    url: 'https://www.zola.com/',
    opensNewTab: true,
    disclosure: CASH_FUND_DISCLOSURE,
  },
];

export class MockRegistry implements RegistryProvider {
  readonly kind = 'registry' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { describeLinks: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async describeLinks() {
    return MOCK_REGISTRY_LINKS;
  }
}

export class MockCashFund implements CashFundProvider {
  readonly kind = 'cash-fund' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { describeLinks: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async describeLinks() {
    return MOCK_CASH_FUND_LINKS;
  }
}

/** Links configured by admins (JSON), validated against the redirect allowlist. */
export class ConfiguredLinks<K extends 'registry' | 'cash-fund'> {
  readonly name = 'configured';
  readonly mode = 'deep-link' as const;
  readonly capabilities = { describeLinks: true };
  constructor(readonly kind: K, private readonly links: GiftLink[], private readonly rejected: string[]) {}
  validateConfig() {
    return { ok: true, missing: [], warnings: this.rejected };
  }
  async health() {
    return upHealth(`${this.links.length} links`);
  }
  async describeLinks() {
    return this.links;
  }
}
