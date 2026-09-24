import type { NavItem, NavModel } from '@/themes/types';

const SHORT: Record<string, string> = {
  'Claim your invitation': 'Claim',
  'Your invitation': 'Invitation',
  'Your Weekend': 'Weekend',
  'Photos & Video': 'Photos',
  'Add photos': 'Photos',
  Transportation: 'Transport',
  'Share an Adventure': 'Share',
  'Our Adventures': 'Adventures',
  'Our Story': 'Story',
  'Travel & Stay': 'Travel',
  'The Wedding': 'Wedding',
  'Ask Us': 'Ask us',
};

/** One-line labels for narrow cells; the full label stays in the "Menu" sheet. */
export function shortLabel(label: string): string {
  return SHORT[label] ?? label;
}

export function isCurrent(item: NavItem, nav: NavModel): boolean {
  return !item.external && item.href === nav.currentPath;
}

/** Cells for a bottom bar: quick actions first, then primary items, de-duplicated, capped. */
export function bottomCells(nav: NavModel, max: number): NavItem[] {
  const out: NavItem[] = [];
  const seen = new Set<string>();
  for (const item of [...nav.sticky, ...nav.primary, ...nav.more]) {
    if (seen.has(item.href) || item.href === '/') continue;
    seen.add(item.href);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Every page link a shell lists, in state order, then the account slot (always last): "Sign in", or
 * the account menu once signed in. The household's pages are not here — only in that menu.
 */
export function allItems(nav: NavModel): NavItem[] {
  return [...nav.primary, ...nav.more, ...(nav.account ? [nav.account] : [])];
}

/** The account slot in `allItems`: shells render the account menu there instead of a plain link. */
export function isAccount(item: NavItem, nav: NavModel): boolean {
  return !!nav.account && item.href === nav.account.href;
}
