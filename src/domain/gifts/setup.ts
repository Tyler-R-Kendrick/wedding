import type { LifecycleState } from '@/contracts/lifecycle';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { assertAllowedRedirect } from '@/lib/redirects';
import { STATE_IN_SENTENCE } from '@/domain/lifecycle/words';

/**
 * What /admin/gifts needs to tell the couple, in the order they need it: can guests see the page at
 * all, and if not, what is the one thing standing in the way.
 *
 * The console used to answer that with four raw tables. The fund table said "Shown: yes" for all
 * four built-in funds while `listGiftFunds` returned none of them to guests — there was no way to
 * give yet, so there were no funds either — and nothing on the screen connected the two. This module
 * is where that connection is made, once, so the page cannot say "shown" about something no guest
 * can see.
 */

/** Registry providers the site recognises by host. Anything else on the allowlist is `custom`. */
export const REGISTRY_PROVIDERS = [
  { id: 'zola', name: 'Zola', host: 'zola.com' },
  { id: 'theknot', name: 'The Knot', host: 'theknot.com' },
  { id: 'withjoy', name: 'Joy', host: 'withjoy.com' },
] as const;

export type RegistryProviderId = (typeof REGISTRY_PROVIDERS)[number]['id'] | 'custom';

export type DetectedRegistry =
  | { ok: true; provider: RegistryProviderId; providerName: string; host: string; url: string }
  | { ok: false; message: string };

/**
 * Reads a pasted registry link: which provider it is on, and whether guests may be sent there at all.
 *
 * The couple used to pick the provider from a menu AND paste the link, which let the two disagree
 * ("Zola" beside a theknot.com URL). The host already says which it is. A link without a scheme
 * ("zola.com/registry/…") is what people copy out of an address bar, so it gets `https://` added
 * rather than refused.
 */
export function detectRegistryProvider(raw: string): DetectedRegistry {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, message: 'Paste the link to your registry.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const allowed = assertAllowedRedirect(withScheme);
  if (!allowed.ok) {
    const known = REGISTRY_PROVIDERS.map((p) => p.name);
    return {
      ok: false,
      message:
        allowed.error.code === 'validation'
          ? 'That is not a web address. Copy the link from your registry’s “share” button and paste it here.'
          : `Guests can only be sent to registries the site trusts: ${known.slice(0, -1).join(', ')} or ${known[known.length - 1]}. That link is not on one of them.`,
    };
  }
  const host = allowed.value.hostname.toLowerCase();
  const hit = registryProviderFor(host);
  const homePage = registryHomePageMessage(allowed.value);
  if (homePage) return { ok: false, message: homePage };
  return { ok: true, provider: hit?.id ?? 'custom', providerName: hit?.name ?? host, host, url: allowed.value.toString() };
}

/**
 * The sentence refusing a registry provider's home page, or null when `url` is not one. A provider's
 * home page is not a registry: it is what the removed placeholders linked to, and it sends a guest to
 * a search box. Ask for the page that is actually theirs. The check step and the save both call this,
 * so a save cannot skip what the check step refuses.
 */
export function registryHomePageMessage(url: URL): string | null {
  const hit = registryProviderFor(url.hostname);
  if (!hit || (url.pathname !== '/' && url.pathname !== '')) return null;
  return `That is ${hit.name}’s home page. Open your own registry on ${hit.name}, copy its share link, and paste that.`;
}

/** The registry provider a host belongs to, or undefined for any other allowlisted host. */
export function registryProviderFor(host: string): (typeof REGISTRY_PROVIDERS)[number] | undefined {
  const h = host.toLowerCase();
  return REGISTRY_PROVIDERS.find((p) => h === p.host || h.endsWith(`.${p.host}`));
}

export interface GiftsSetupInput {
  /** The lifecycle state guests are in now (never an admin preview). */
  state: LifecycleState;
  /** Whether the account menu lists Gifts in a state (`memberNavFor`). */
  listsGifts: (state: LifecycleState) => boolean;
  /** Registry links an admin saved and left active, excluding placeholders. */
  wishlistLinks: number;
  /** Active ways to give. */
  rails: number;
  /** Funds switched on. */
  shownFunds: number;
}

export type SetupStep = 'wishlist' | 'rails' | 'funds' | 'page';
/** The steps the couple act on; `page` follows the lifecycle, not anything they set here. */
export type NextStep = Exclude<SetupStep, 'page'>;

export interface GiftsSetup {
  /** True when a signed-in guest can find the page AND it has something on it to give with. */
  live: boolean;
  /** One sentence: where things stand. */
  headline: string;
  /** What each part of the setup is doing for guests right now. */
  steps: Record<SetupStep, { done: boolean; summary: string }>;
  /** The first unfinished step, which the page leads with. Null once everything is done. */
  next: NextStep | null;
  /** When the account menu starts listing Gifts, if it does not yet. */
  opensAt: LifecycleState | null;
}

export function giftsSetup(i: GiftsSetupInput): GiftsSetup {
  const pageOpen = i.listsGifts(i.state);
  const opensAt = pageOpen ? null : (LIFECYCLE_STATES.slice(LIFECYCLE_STATES.indexOf(i.state) + 1).find(i.listsGifts) ?? null);
  const fundsLive = i.rails > 0 && i.shownFunds > 0;
  const steps: GiftsSetup['steps'] = {
    wishlist: {
      done: i.wishlistLinks > 0,
      summary: i.wishlistLinks > 0 ? 'Linked. Guests are sent to your registry to choose a gift.' : 'Not linked. Guests are told you have not chosen where to keep a wishlist.',
    },
    rails: {
      done: i.rails > 0,
      summary: i.rails > 0 ? `${i.rails} ${i.rails === 1 ? 'way' : 'ways'} to send a gift of money.` : 'None yet, so guests see no gifts of money at all.',
    },
    funds: {
      done: fundsLive,
      summary: fundsLive
        ? `${i.shownFunds} ${i.shownFunds === 1 ? 'fund' : 'funds'} shown to guests.`
        : i.rails === 0
          ? `${i.shownFunds} ready, but hidden until you add a way to give.`
          : 'Every fund is hidden. Show at least one.',
    },
    page: {
      done: pageOpen,
      summary: pageOpen
        ? 'Signed-in guests find Gifts in their account menu.'
        : opensAt
          ? `Guests find Gifts in their account menu from ${STATE_IN_SENTENCE[opensAt]}. The site is at ${STATE_IN_SENTENCE[i.state]} now; anyone with the link can still open it once signed in.`
          : `The account menu does not list Gifts at ${STATE_IN_SENTENCE[i.state]}.`,
    },
  };
  const somethingToGive = steps.wishlist.done || fundsLive;
  const order: NextStep[] = ['wishlist', 'rails', 'funds'];
  const next = order.find((s) => !steps[s].done) ?? null;
  const live = pageOpen && somethingToGive;
  const headline = live
    ? next
      ? 'Guests can see Gifts. There is more you can add.'
      : 'Guests can see Gifts, with your wishlist and gifts of money.'
    : !somethingToGive
      ? 'Guests have nothing to give with yet.'
      : 'Ready, but not in guests’ menu yet.';
  return { live, headline, steps, next, opensAt };
}
