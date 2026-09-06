/** Audit hygiene (review N1): free text reaches audit metadata only capped and with addresses removed. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubForAudit(text: string | null | undefined, max = 200): string | null {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).replace(EMAIL, '[email]').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
