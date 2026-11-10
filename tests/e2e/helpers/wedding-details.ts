/**
 * What a signed-out reader must never be shown: when the wedding is, and where. The venue is matched
 * as `src/domain/content/venue-guard.ts` matches it (its name, or its street address), so a public
 * memory of somewhere else on Michigan Avenue is not mistaken for it.
 */
export const WEDDING_DETAILS = /July 17|chicago\s+athletic|\b12\s+s(?:outh|\.)?\s+michigan\b/i;
