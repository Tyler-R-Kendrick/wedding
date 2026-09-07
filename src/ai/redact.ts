/**
 * PII redaction for anything the concierge persists (session tail, answer traces). Guests type
 * emails, phone numbers and addresses into a chat box; none of that needs to be stored to answer a
 * follow-up. Redaction is lossy by design and runs before any write.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const LONG_DIGITS = /\b\d{7,}\b/g;
const STREET = /\b\d{1,6}\s+(?:[A-Z][A-Za-z]*\.?\s){0,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy)\b\.?/g;
const URL_WITH_QUERY = /https?:\/\/\S+\?\S*/g;

export const REDACTED = '[redacted]';

export function redactPii(text: string): string {
  return text
    .replace(URL_WITH_QUERY, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, REDACTED)
    .replace(STREET, REDACTED)
    .replace(LONG_DIGITS, REDACTED);
}

/** Redact, collapse whitespace, and cap length for storage. */
export function redactForStorage(text: string, max: number): string {
  const clean = redactPii(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
