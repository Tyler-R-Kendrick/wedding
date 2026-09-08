import type { AuditEventId } from './ids';
import type { PrincipalRef } from './principal';

/**
 * Audit trail for high-value operations. Rows are append-only.
 * Never log secrets, OTPs, voucher codes, full dietary/accessibility text,
 * raw biometric vectors, or AI prompts containing unnecessary PII.
 */
export const AUDIT_ACTIONS = [
  'invitation.issued', 'invitation.revoked', 'invitation.claimed',
  'identity.bound', 'identity.rebound', 'identity.reset', 'session.step_up', 'session.revoked',
  'invitation.rotated', 'guest.merged', 'guest.imported', 'guest.exported', 'admin.role_changed',
  'passkey.registered', 'passkey.removed', 'identity.email_changed',
  'rsvp.submitted', 'rsvp.admin_override',
  'seating.published', 'seating.unpublished', 'seating.changed',
  'transport.entitlement_assigned', 'transport.claimed', 'transport.claim_failed',
  'external_action.initiated', 'external_action.confirmed', 'external_action.failed',
  'biometric.consent_granted', 'biometric.consent_revoked', 'biometric.deleted',
  'media.uploaded', 'media.moderated', 'media.published', 'media.hidden', 'media.imported',
  'lifecycle.published', 'lifecycle.previewed',
  'content.updated', 'content.verified',
  'provider.configured', 'flag.changed',
  // Retry and cancel used to leave only the pipeline's own `capability.invoked` row, whose metadata
  // carries a keyed input hash and not the job id — so the trail recorded that someone retried A
  // job, never which one. Proposed by swarm L at level 14 rather than taken, because this is a
  // contract file; taken here.
  'job.retried', 'job.cancelled',
  'ai.grounding_failed', 'ai.security_alert',
  'capability.denied', 'capability.invoked', 'capability.failed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditOutcome = 'success' | 'denied' | 'failed';

export interface AuditEvent {
  id: AuditEventId;
  at: string; // ISO
  actor: PrincipalRef;
  action: AuditAction;
  target: { type: string; id: string };
  outcome: AuditOutcome;
  /** Correlation with the HTTP request / capability invocation. */
  requestId: string;
  /** Redacted, JSON-serializable. Use `redactForAudit` before writing. */
  metadata?: Record<string, unknown>;
}

export interface AuditSink {
  record(event: Omit<AuditEvent, 'id' | 'at'>): Promise<AuditEventId>;
}

/**
 * Words that make a key's value sensitive. This used to be a pattern ANCHORED at the start of the
 * key (`/^(otp|code|…)/`), which meant `guestEmail`, `contactPhone` and `mailingAddress` were
 * written to `audit_events` verbatim. Nothing wrote such a key, so nothing leaked — but the write
 * side is the pass that matters, because it is destructive: what it does not redact is in the table
 * for anyone who reads it with psql or an export, long after the request is gone. Found at level 14
 * by a test written to prove the read-time projection was a genuine second pass rather than a copy.
 */
export const AUDIT_SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  'otp', 'code', 'codes', 'token', 'tokens', 'secret', 'secrets', 'password', 'passwords', 'voucher', 'vouchers',
  'redemption', 'dietary', 'allergy', 'allergies', 'accessibility', 'needs', 'embedding', 'embeddings', 'vector',
  'vectors', 'prompt', 'prompts', 'email', 'emails', 'phone', 'phones', 'address', 'addresses', 'ssn', 'pii',
]);

/**
 * Keys a sensitive word would otherwise catch, which carry a closed enum rather than a value.
 * `errorCode` is a `CapabilityErrorCode` and is the single most useful field on a failed row —
 * redacting it destructively at write time would lose it for good. Reviewed one at a time, by name.
 */
export const AUDIT_ENUM_KEYS: ReadonlySet<string> = new Set(['errorCode', 'claimMethod']);

/** Splits camelCase and snake_case into lowercase words, so a sensitive word anywhere in a key counts. */
export const auditKeyWords = (key: string): string[] =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).map((w) => w.toLowerCase()).filter(Boolean);

/**
 * A boolean is never sensitive: it carries one bit and cannot be an OTP, an email or free text.
 * That is what keeps `includeNeeds` on a guest export and `viaToken` on a claim readable, while
 * every string under the same kind of key is redacted.
 */
export function isAuditSensitive(key: string, value: unknown): boolean {
  if (typeof value === 'boolean') return false;
  if (AUDIT_ENUM_KEYS.has(key)) return false;
  return auditKeyWords(key).some((w) => AUDIT_SENSITIVE_WORDS.has(w));
}

/** Shallow redaction of sensitive keys. Nested objects are summarized by shape only. */
export function redactForAudit(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (isAuditSensitive(k, v)) { out[k] = '[redacted]'; continue; }
    if (v && typeof v === 'object') { out[k] = Array.isArray(v) ? `[array:${v.length}]` : '[object]'; continue; }
    if (typeof v === 'string' && v.length > 200) { out[k] = v.slice(0, 200) + '…'; continue; }
    out[k] = v;
  }
  return out;
}
