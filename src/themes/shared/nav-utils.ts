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

export function allItems(nav: NavModel): NavItem[] {
  return [...nav.primary, ...nav.more];
}
