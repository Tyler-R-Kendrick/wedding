/**
 * E.164 phone normalization for guest sign-in (US default). Stored form is always E.164 when valid.
 */

const US_DIGITS = /^\d{10}$/;
const E164 = /^\+[1-9]\d{6,14}$/;

/** Strip to digits and optional leading + for parsing. */
function digitsOnly(raw: string): string {
  return raw.replace(/[^\d+]/g, '').replace(/^\+/, '');
}

/**
 * Normalize guest/admin input to E.164. US numbers without country code get +1.
 * Returns null when the shape is not a plausible mobile number.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (E164.test(trimmed)) return trimmed;
  const d = digitsOnly(trimmed);
  if (!d) return null;
  if (d.length === 10 && US_DIGITS.test(d)) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1') && US_DIGITS.test(d.slice(1))) return `+${d}`;
  if (trimmed.startsWith('+') && d.length >= 7 && d.length <= 15) return `+${d}`;
  return null;
}

export function isPhoneShape(value: string): boolean {
  return normalizePhoneE164(value) !== null;
}

/** Mask for UI: (•••) •••-1234 from E.164 US. */
export function maskPhone(e164: string): string {
  const d = digitsOnly(e164);
  const last10 = d.length >= 10 ? d.slice(-10) : d;
  if (last10.length < 4) return '••••';
  const area = last10.length >= 10 ? last10.slice(0, 3) : '•••';
  const mid = last10.length >= 7 ? '•••' : '••';
  const tail = last10.slice(-4);
  return `(${area}) ${mid}-${tail}`;
}

/** Stable auth email when a guest has no inbox on file (phone-only sign-in). */
export function phoneAuthEmail(e164: string): string {
  const d = digitsOnly(e164);
  return `phone+${d}@signin.kendrick.wedding`;
}
