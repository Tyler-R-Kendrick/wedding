import { MockCashFund } from '../registry/mock';
import type { CashFundProvider } from '../registry/types';

export type { CashFundProvider, GiftLink } from '../registry/types';
export { MockCashFund } from '../registry/mock';

/** Language matters: the couple prefer "help us with our next adventures" over "cash fund" in guest-facing copy. */
export function createCashFundProvider(): CashFundProvider {
  /*
   * Gift links live in the `gift_links` table and are edited in /admin/gifts, which validates
   * every URL against the redirect allowlist at write time and again at read time. This used to
   * take a hand-maintained JSON blob from the environment as a second source, which only ever
   * applied when the admin table was empty — so it was a way for the couple to maintain the same
   * data twice, in the format least suited to it. The provider now only supplies the built-in
   * placeholders that `listGiftLinks` falls back to when nothing has been configured yet.
   */
  return new MockCashFund();
}
