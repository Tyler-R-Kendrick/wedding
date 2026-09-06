/**
 * Masks an email for guest-facing copy ("we sent a code to t•••@g•••.com"). Reveals one
 * character of the local part and one of the domain plus the TLD — enough for the guest to
 * recognise their inbox, not enough for a forwarded-link holder to learn the address.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.charAt(0)}•••@${host.charAt(0)}•••${tld}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmailShape = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && EMAIL_PATTERN.test(v);
