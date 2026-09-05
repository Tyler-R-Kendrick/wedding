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
  placeholderNote: 'TODO(Tyler & Sara): the real links go here once the registry is chosen.',
  thanks: 'Thank you. Truly.',
} as const;

export const FORBIDDEN_GIFT_WORDS = [/cash\s*fund/i, /\bdonat(e|ion|ions)\b/i, /\$\s?\d/];
