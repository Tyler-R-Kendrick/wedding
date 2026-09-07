import { okConfig, upHealth } from '../base';
import type { CashFundProvider, GiftLink, RegistryProvider } from './types';

/**
 * No links at all — which is the honest answer, because the couple have not chosen a provider.
 *
 * These used to be one row each pointing at `https://www.zola.com/` with `provider: 'zola'`, so the
 * public gifts page rendered "via Zola" twice and offered two live outbound links to a registry
 * that does not exist. `docs/design/brief.md` §2 lists Registry as "(NOT settled)". The authoring
 * marker in the label had been the only thing hinting the card was not real, and removing it (this
 * level) left the invented brand standing on its own.
 *
 * `placeholder: true` cannot rescue a card that names a company and links to it: a guest reads the
 * brand, and `list_gift_links` is exposed to the AI concierge and WebMCP, so an assistant would
 * have answered "they are registered at Zola". An empty list is a fact; a named provider is not.
 * The pages render their own editorial empty state (GIFTS_COPY.registryPending /
 * adventurePending), and the ladder is exercised by configured links — env JSON via
 * `ConfiguredLinks`, or admin rows, both of which carry a provider the couple actually chose.
 */
export const MOCK_REGISTRY_LINKS: readonly GiftLink[] = [];

export const MOCK_CASH_FUND_LINKS: readonly GiftLink[] = [];

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
  async describeLinks(): Promise<GiftLink[]> {
    return [...MOCK_REGISTRY_LINKS];
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
  async describeLinks(): Promise<GiftLink[]> {
    return [...MOCK_CASH_FUND_LINKS];
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
