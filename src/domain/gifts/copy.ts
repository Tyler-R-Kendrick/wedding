/**
 * Guest-facing gift language, fixed by the brief (§2 Registry, ADR-0004 §6): presence first,
 * "help us with our next adventures" for experience gifts, never "cash fund" or "donate",
 * no amounts suggested by the site. Tests assert the forbidden words never appear.
 */
export const GIFTS_COPY = {
  eyebrow: 'Gifts',
  title: 'Help us with our next adventures',
  lede: 'Having you with us in Chicago is the gift. If you would like to give something more, here is where to find our wishlist and a way to send us on our next adventure.',
  registryHeading: 'Our wishlist',
  registryIntro: 'A conventional list of things for our home, kept with a registry provider.',
  adventureHeading: 'Our next adventures',
  adventureIntro: 'Experiences, trips and gift cards, gathered with a provider so that everything stays simple and secure.',
  handoffNote: 'Each link opens the provider’s own site in a new tab. Anything you choose there is handled by them; we never see payment details.',
  placeholderNote: 'the real links, once the registry is chosen',
  /**
   * Shown in place of a card when a section has no configured links. The couple have not chosen a
   * provider (brief §2 lists Registry as NOT settled), so the page says so instead of naming one:
   * an invented brand with a live link is a fact the site has no right to state, and `placeholder`
   * on a card that reads "via Zola" does not undo it.
   */
  registryPending: 'where to find our wishlist, once we have chosen where to keep it',
  adventurePending: 'how to help with our next adventures, once we have set it up',
  /** With nothing to click yet, the one thing a guest can do here is reach us. */
  askIntro: 'In the meantime, if you would like to give something and cannot wait for us to decide,',
  askLabel: 'ask us',
  thanks: 'Thank you. Truly.',
} as const;

/**
 * One sentence about the gift arrangements as they ACTUALLY stand, for the concierge and any other
 * reader that has no page around it.
 *
 * `registryIntro` describes a wishlist that is kept with a provider. That is the page's copy for the
 * day a provider exists; today none does, and shipping it as a bare fact told a guest the couple
 * keep a registry — beside a placeholder on the same page saying they have not chosen where. The
 * page now shows the intro only next to real links; this is what everyone else is told.
 */
export function giftsStatement(counts: { registry: number; adventures: number }): string {
  const parts: string[] = [GIFTS_COPY.lede];
  if (!counts.registry && !counts.adventures) {
    parts.push('Sara and Tyler have not chosen where to keep either list yet. The Gifts page will carry the links as soon as they do, and nothing is expected of you before then.');
  } else {
    if (counts.registry) parts.push(GIFTS_COPY.registryIntro);
    else parts.push('There is no wishlist to link to yet — Sara and Tyler have not chosen where to keep one.');
    if (counts.adventures) parts.push(GIFTS_COPY.adventureIntro);
    else parts.push('There is no way to help with the next adventures yet either.');
  }
  parts.push(GIFTS_COPY.handoffNote);
  return parts.join(' ');
}

export const FORBIDDEN_GIFT_WORDS = [/cash\s*fund/i, /\bdonat(e|ion|ions)\b/i, /\$\s?\d/];
