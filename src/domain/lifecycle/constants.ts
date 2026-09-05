/** Query parameter / cookie carrying an admin lifecycle preview (ADR-0012 §3). Safe to import from proxy.ts. */
export const PREVIEW_QUERY = 'preview';
export const PREVIEW_COOKIE = 'lifecycle-preview';
/** Preview tokens expire; a rehearsal is a session, not a setting. */
export const PREVIEW_TTL_SECONDS = 12 * 60 * 60;
