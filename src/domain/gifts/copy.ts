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
  /**
   * Gifts of money (ADR-0013). Each goes straight to the couple's own account on a network the guest
   * already uses; the site is not in the path of the money, so it cannot charge a fee or hold it.
   */
  fundsIntro: 'If you would like to give toward something, pick what it is for and send it however suits you. It goes from your account to ours. This site never touches it, holds it, or takes a cut.',
  waysHeading: 'Ways to send it',
  waysIntro: 'Paying from a bank account or an app balance is free on every one of these. Paying by card can cost you a fee on some of them, and each says so below.',
  needsInvitation: 'Open this page from your invitation link to see where to send it.',
  confirmName: 'Check that the name reads',
  venmoPrivacy: 'Venmo shows payments to your friends unless you choose Private before you send.',
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
export function giftsStatement(counts: { registry: number; adventures: number; funds?: readonly string[]; rails?: readonly string[] }): string {
  const parts: string[] = [GIFTS_COPY.lede];
  const funds = counts.funds ?? [];
  const rails = counts.rails ?? [];
  if (funds.length && rails.length) {
    // A way to give exists, so the sentences about nothing being set up would be false.
    parts.push(counts.registry ? GIFTS_COPY.registryIntro : 'There is no wishlist to link to yet — Sara and Tyler have not chosen where to keep one.');
    parts.push(`You can give toward ${list(funds.map((f) => `“${f}”`))}, sent from your own account straight to Sara and Tyler's with ${list(rails, 'or')}. This site never touches or holds the money. Paying from a bank account or an app balance is free; some apps add a fee for paying by card.`);
    if (counts.adventures) parts.push(GIFTS_COPY.adventureIntro);
  } else if (!counts.registry && !counts.adventures) {
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

function list(items: readonly string[], joiner = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;
}

export const FORBIDDEN_GIFT_WORDS = [/cash\s*fund/i, /\bdonat(e|ion|ions)\b/i, /\$\s?\d/];
