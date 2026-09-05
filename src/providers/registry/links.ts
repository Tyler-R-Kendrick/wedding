import { assertAllowedRedirect } from '@/lib/redirects';
import { giftLinkSchema, type GiftLink } from './types';

export const REGISTRY_DISCLOSURE = 'You will leave our site to the registry provider. Purchases happen there; we never see payment details.';
export const CASH_FUND_DISCLOSURE = 'You will leave our site to the gift provider. Gifts are handled there; we never see payment details.';

/** Parses an admin/env-provided JSON array of links, dropping anything off the redirect allowlist. */
export function parseGiftLinks(json: string, defaultDisclosure: string): { links: GiftLink[]; rejected: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { links: [], rejected: ['invalid JSON'] };
  }
  if (!Array.isArray(raw)) return { links: [], rejected: ['expected an array'] };
  const links: GiftLink[] = [];
  const rejected: string[] = [];
  for (const item of raw) {
    const parsed = giftLinkSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push('invalid link entry');
      continue;
    }
    if (!assertAllowedRedirect(parsed.data.url).ok) {
      rejected.push(`not allowlisted: ${parsed.data.id}`);
      continue;
    }
    links.push({ ...parsed.data, disclosure: parsed.data.disclosure ?? defaultDisclosure, opensNewTab: true });
  }
  return { links, rejected };
}
