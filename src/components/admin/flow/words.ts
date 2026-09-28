/**
 * Small pieces of console wording that several screens build from names (CONVENTIONS.md, "Words").
 */

/**
 * "Ada's", "the Lovelaces'", "James's". A plural household name ending in s takes the apostrophe
 * alone ("The Lovelaces’ link", not "The Lovelaces’s"); a singular name takes ’s. The one ambiguous
 * case — a singular name ending in s — follows the Chicago Manual (“James’s”), so only a name that
 * reads as a plural (a family, “The …s”) drops the s.
 */
export function possessive(name: string): string {
  const n = name.trim();
  if (!n || /['’]$/.test(n)) return n;
  // "The Lovelaces", "the Harrises": a family named as a plural takes the apostrophe alone.
  return /^the\s.+s$/i.test(n) ? `${n}’` : `${n}’s`;
}
