/**
 * When a page may install a model on its own, without the guest asking. The models are tens of
 * megabytes each, and a guest on a metered phone plan or a nearly full phone should not pay for
 * them just by opening the site; they are fetched instead the first time the guest uses the
 * planner. Everything this reads is optional in some browser, and a missing signal never blocks.
 */
import { MIN_STORAGE_HEADROOM } from './spec';

export type InstallEnvironment = {
  connection?: { saveData?: boolean; type?: string };
  webdriver?: boolean;
  storage?: { estimate?: () => Promise<{ quota?: number; usage?: number }> };
};

/** `nav` defaults to the browser's navigator; `null` means there is none (no install). */
export async function autoInstallAllowed(nav: InstallEnvironment | null = (globalThis.navigator as InstallEnvironment | undefined) ?? null): Promise<boolean> {
  if (!nav) return false;
  // A browser driven by a test or a crawler is nobody's phone: it must not fetch tens of megabytes
  // on every page it opens. It still installs when it uses the planner, like anyone else.
  if (nav.webdriver) return false;
  const connection = nav.connection;
  // The guest asked their browser to save data, or the browser knows this is a mobile network.
  if (connection?.saveData) return false;
  if (connection?.type === 'cellular') return false;
  try {
    const estimate = await nav.storage?.estimate?.();
    if (estimate && typeof estimate.quota === 'number') {
      const headroom = estimate.quota - (estimate.usage ?? 0);
      if (headroom < MIN_STORAGE_HEADROOM) return false;
    }
  } catch {
    // No estimate: the browser will evict the cache if it must, so do not hold back for it.
  }
  return true;
}
