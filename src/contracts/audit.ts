import type { AuditEventId } from './ids';
import type { PrincipalRef } from './principal';

/**
 * Audit trail for high-value operations. Rows are append-only.
 * Never log secrets, OTPs, voucher codes, full dietary/accessibility text,
 * raw biometric vectors, or AI prompts containing unnecessary PII.
 */
export const AUDIT_ACTIONS = [
  'invitation.issued', 'invitation.revoked', 'invitation.claimed',
  'identity.bound', 'identity.rebound', 'identity.reset', 'session.step_up',
  'rsvp.submitted', 'rsvp.admin_override',
  'seating.published', 'seating.unpublished', 'seating.changed',
  'transport.entitlement_assigned', 'transport.claimed', 'transport.claim_failed',
  'external_action.initiated', 'external_action.confirmed', 'external_action.failed',
  'biometric.consent_granted', 'biometric.consent_revoked', 'biometric.deleted',
  'media.uploaded', 'media.moderated', 'media.published', 'media.hidden', 'media.imported',
  'lifecycle.published', 'lifecycle.previewed',
  'content.updated', 'content.verified',
  'provider.configured', 'flag.changed',
  'ai.grounding_failed', 'ai.security_alert',
  'capability.denied',
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

const REDACT_KEYS = /^(otp|code|token|secret|password|voucher|redemption|dietary|allergy|accessibility|needs|embedding|vector|prompt|email|phone|address)/i;

/** Shallow redaction of sensitive keys. Nested objects are summarized by shape only. */
export function redactForAudit(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (REDACT_KEYS.test(k)) { out[k] = '[redacted]'; continue; }
    if (v && typeof v === 'object') { out[k] = Array.isArray(v) ? `[array:${v.length}]` : '[object]'; continue; }
    if (typeof v === 'string' && v.length > 200) { out[k] = v.slice(0, 200) + '…'; continue; }
    out[k] = v;
  }
  return out;
}
