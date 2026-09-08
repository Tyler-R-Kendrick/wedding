import { describe, expect, it } from 'vitest';
import { redactForAudit } from '@/contracts/audit';
import { actorView, projectAuditMetadata } from '@/domain/ops/audit';
import { describeTransition, allowedTransitions } from '@/domain/ops/lifecycle';

/**
 * The audit screen is a read surface over the record of everything everyone did, and it is readable
 * by `admin_audit` — which a moderator holds without `admin_guest_ops`. These are the guarantees
 * that make rendering `metadata` safe at all. Every one of them fails against a page that renders
 * `row.metadata` directly, which is what this replaces.
 */
describe('projectAuditMetadata', () => {
  it('withholds the value of every free-text key while still reporting that it was there', () => {
    const { metadata, redacted } = projectAuditMetadata({
      reason: 'moved to jane.doe@example.com after she called',
      note: 'counsel said fine, see the email',
      question: 'what is my table',
      answer: 'table 4',
      to: 'RSVP_OPEN',
    });
    expect(metadata).toEqual({ reason: '[withheld]', note: '[withheld]', question: '[withheld]', answer: '[withheld]', to: 'RSVP_OPEN' });
    expect(redacted).toBe(true);
    // The point of the exercise: none of the free text survives anywhere in the output.
    expect(JSON.stringify(metadata)).not.toContain('jane.doe@example.com');
    expect(JSON.stringify(metadata)).not.toContain('counsel said fine');
  });

  it('applies the write-time redaction a second time, so a row written before a rule existed is still safe', () => {
    // A row that reached the table without redactForAudit (older code, a direct insert, a future
    // key nobody thought about). Read-time redaction is the second, independent pass.
    const raw = { otp: '483920', voucherCode: 'UBER-XYZ', guestEmail: 'a@b.com', dietaryNeeds: 'severe nut allergy', durationMs: 12 };
    const { metadata } = projectAuditMetadata(raw);
    expect(metadata).toMatchObject({ otp: '[redacted]', voucherCode: '[redacted]', durationMs: '12' });
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('483920');
    expect(serialized).not.toContain('UBER-XYZ');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('nut allergy');
  });

  it('redacts a sensitive word anywhere in the key, not only at the start', () => {
    // redactForAudit anchors its pattern, so `guestEmail` reaches the table verbatim. The read-time
    // pass splits the key into words instead, which is the whole reason it is a second pass rather
    // than the same call twice.
    const { metadata } = projectAuditMetadata({ guestEmail: 'a@b.com', mailingAddress: '1 Main St', contactPhone: '+1 555', voucherCode: 'X' });
    expect(metadata).toEqual({ guestEmail: '[redacted]', mailingAddress: '[redacted]', contactPhone: '[redacted]', voucherCode: '[redacted]' });
  });

  it('keeps booleans, because one bit cannot be an OTP, an email or free text', () => {
    // These are exactly the flags an auditor needs: whether an export included dietary needs, and
    // whether a claim went through an invitation token.
    const { metadata } = projectAuditMetadata({ includeNeeds: true, includeAddress: false, viaToken: true, needs: 'severe nut allergy' });
    expect(metadata).toEqual({ includeNeeds: 'true', includeAddress: 'false', viaToken: 'true', needs: '[redacted]' });
  });

  it('keeps the two closed enums that a sensitive word would otherwise swallow', () => {
    const { metadata } = projectAuditMetadata({ errorCode: 'forbidden', claimMethod: 'otp', otpCode: '123456' });
    expect(metadata).toEqual({ errorCode: 'forbidden', claimMethod: 'otp', otpCode: '[redacted]' });
  });

  it('keeps the enum-ish neighbours of withheld keys readable', () => {
    // `reasons` is the concierge's joined enum list and `references` is a count: exact-match, not a
    // prefix match, is what lets the trail stay useful.
    const { metadata } = projectAuditMetadata({ reasons: 'no_source,dropped', references: 3, reason: 'typed by a person' });
    expect(metadata).toEqual({ reasons: 'no_source,dropped', references: '3', reason: '[withheld]' });
  });

  it('caps a long value and says it did', () => {
    const { metadata, redacted } = projectAuditMetadata({ rules: 'x'.repeat(400) });
    expect(metadata!.rules!.length).toBeLessThanOrEqual(121);
    expect(metadata!.rules!.endsWith('…')).toBe(true);
    expect(redacted).toBe(true);
  });

  it('summarises nested values by shape rather than printing them', () => {
    const { metadata } = projectAuditMetadata(redactForAudit({ changes: { table: 4, seat: 'A' }, guests: ['g1', 'g2'] }));
    expect(metadata).toEqual({ changes: '[object]', guests: '[array:2]' });
  });

  it('caps the number of keys so one enormous row cannot dominate the page', () => {
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]));
    const { metadata, redacted } = projectAuditMetadata(wide);
    expect(Object.keys(metadata!)).toHaveLength(24);
    expect(redacted).toBe(true);
  });

  it('returns null, not an empty object, when a row carried no metadata', () => {
    expect(projectAuditMetadata(null)).toEqual({ metadata: null, redacted: false });
  });
});

describe('actorView', () => {
  it('reduces a principal reference to a kind and one opaque id', () => {
    expect(actorView({ kind: 'admin', adminId: 'AD1' } as never)).toEqual({ kind: 'admin', ref: 'AD1' });
    expect(actorView({ kind: 'guest', guestId: 'G1' } as never)).toEqual({ kind: 'guest', ref: 'G1' });
    expect(actorView({ kind: 'system', component: 'cron' } as never)).toEqual({ kind: 'system', ref: 'cron' });
    expect(actorView({ kind: 'anonymous' } as never)).toEqual({ kind: 'anonymous', ref: null });
  });
});

describe('lifecycle transitions', () => {
  it('offers forward by any distance and back by exactly one', () => {
    const from = allowedTransitions('RSVP_OPEN').map((t) => t.to);
    expect(from).toContain('INVITATIONS_OPEN'); // back one
    expect(from).toContain('ARCHIVE'); // forward, any distance
    expect(from).not.toContain('SAVE_THE_DATE'); // back two
    expect(from).not.toContain('RSVP_OPEN'); // nowhere
  });

  it('describes a move by the guest navigation it changes', () => {
    const change = describeTransition('TEASER', 'RSVP_OPEN');
    expect(change.direction).toBe('forward');
    expect(change.navGained).toContain('RSVP');
    expect(change.navGained).toContain('Travel & Stay');
    const back = describeTransition('RSVP_OPEN', 'INVITATIONS_OPEN');
    expect(back.direction).toBe('back');
    expect(back.navLost).toContain('RSVP');
  });

  it('has no transition out of the last state', () => {
    expect(allowedTransitions('ARCHIVE').map((t) => t.to)).toEqual(['POST_WEDDING']);
  });
});
