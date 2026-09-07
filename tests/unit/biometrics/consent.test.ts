import { describe, expect, it } from 'vitest';
import type { BiometricConsentRow } from '@/db/schema/biometrics';
import { consentState, describeConsent, hasCurrentConsent } from '@/domain/biometrics/consent';
import {
  CONSENT_MINORS,
  CONSENT_POLICY_VERSION,
  CONSENT_PROVIDER_DISCLOSURE,
  CONSENT_RETENTION,
  CONSENT_TERM,
  CONSENT_TEXT,
  CONSENT_TEXT_HASH,
  consentTextHash,
  currentConsentPolicy,
} from '@/domain/biometrics/policy';

const POLICY = { version: CONSENT_POLICY_VERSION, textHash: CONSENT_TEXT_HASH };

let seq = 0;
const row = (over: Partial<BiometricConsentRow> = {}): BiometricConsentRow =>
  ({
    id: `C${String(++seq).padStart(3, '0')}`,
    guestId: 'GUESTA',
    householdId: 'HOUSEA',
    entry: 'grant',
    grantId: null,
    policyVersion: CONSENT_POLICY_VERSION,
    textHash: CONSENT_TEXT_HASH,
    text: CONSENT_TEXT,
    purpose: 'p',
    term: 't',
    retention: 'r',
    providerDisclosure: 'd',
    scope: 'self_match',
    adultAttested: true,
    ipHash: 'iphash',
    surface: 'ui',
    requestId: 'req',
    grantedAt: new Date('2027-01-01T00:00:00Z'),
    revokedAt: null,
    createdAt: new Date('2027-01-01T00:00:00Z'),
    ...over,
  }) as BiometricConsentRow;

describe('consent state machine', () => {
  it('starts at none: no rows means no consent', () => {
    const s = consentState([], POLICY);
    expect(s).toEqual({ status: 'none', grant: null, revokedAt: null });
    expect(hasCurrentConsent(s)).toBe(false);
  });

  it('is active only for a grant on the current policy version and text', () => {
    const grant = row();
    expect(hasCurrentConsent(consentState([grant], POLICY))).toBe(true);
    expect(consentState([row({ policyVersion: '2020-01-01.old' })], POLICY)).toMatchObject({ status: 'superseded', supersededBy: { version: CONSENT_POLICY_VERSION } });
    expect(consentState([row({ textHash: 'f'.repeat(64) })], POLICY)).toMatchObject({ status: 'superseded' });
    expect(hasCurrentConsent(consentState([row({ policyVersion: 'old' })], POLICY))).toBe(false);
  });

  it('a revoke entry for the latest grant wins over everything', () => {
    const grant = row({ createdAt: new Date('2027-01-01T00:00:00Z') });
    const revoke = row({ entry: 'revoke', grantId: grant.id, grantedAt: null, revokedAt: new Date('2027-02-01T00:00:00Z'), createdAt: new Date('2027-02-01T00:00:00Z') });
    const s = consentState([grant, revoke], POLICY);
    expect(s.status).toBe('revoked');
    expect(s.revokedAt).toBe('2027-02-01T00:00:00.000Z');
    expect(hasCurrentConsent(s)).toBe(false);
  });

  it('a later grant supersedes an earlier revoked one (re-consent works)', () => {
    const first = row({ createdAt: new Date('2027-01-01T00:00:00Z') });
    const revoke = row({ entry: 'revoke', grantId: first.id, createdAt: new Date('2027-02-01T00:00:00Z'), revokedAt: new Date('2027-02-01T00:00:00Z') });
    const second = row({ createdAt: new Date('2027-03-01T00:00:00Z') });
    const s = consentState([first, revoke, second], POLICY);
    expect(s.status).toBe('active');
    expect(s.grant!.id).toBe(second.id);
  });

  it('does not depend on the order rows arrive in, and breaks ties deterministically', () => {
    const a = row({ id: 'C900', createdAt: new Date('2027-01-01T00:00:00Z') });
    const b = row({ id: 'C901', createdAt: new Date('2027-01-01T00:00:00Z') });
    expect(consentState([a, b], POLICY).grant!.id).toBe('C901');
    expect(consentState([b, a], POLICY).grant!.id).toBe('C901');
  });

  it('treats a grant closed by its own stamp as revoked, so the ledger and the index agree', () => {
    const closed = row({ revokedAt: new Date('2027-02-01T00:00:00Z') });
    const s = consentState([closed], POLICY);
    expect(s.status).toBe('revoked');
    expect(s.revokedAt).toBe('2027-02-01T00:00:00.000Z');
    expect(hasCurrentConsent(s)).toBe(false);
  });

  it('a revoke naming an older grant does not revoke the current one', () => {
    const first = row({ createdAt: new Date('2027-01-01T00:00:00Z') });
    const second = row({ createdAt: new Date('2027-02-01T00:00:00Z') });
    const staleRevoke = row({ entry: 'revoke', grantId: first.id, createdAt: new Date('2027-03-01T00:00:00Z') });
    expect(consentState([first, second, staleRevoke], POLICY).status).toBe('active');
  });
});

describe('versioned consent text', () => {
  it('hashes the exact text shown, so any copy change invalidates existing grants', () => {
    expect(CONSENT_TEXT_HASH).toMatch(/^[a-f0-9]{64}$/);
    expect(consentTextHash(CONSENT_TEXT)).toBe(CONSENT_TEXT_HASH);
    expect(consentTextHash(`${CONSENT_TEXT} `)).not.toBe(CONSENT_TEXT_HASH);
    expect(consentState([row({ textHash: consentTextHash(`${CONSENT_TEXT} `) })], POLICY).status).toBe('superseded');
  });

  it('states purpose, term, retention, provider and the minors rule in the text itself', () => {
    for (const clause of [CONSENT_TERM, CONSENT_RETENTION, CONSENT_PROVIDER_DISCLOSURE, CONSENT_MINORS]) expect(CONSENT_TEXT).toContain(clause);
    expect(CONSENT_MINORS).toMatch(/18 or older/);
    expect(CONSENT_TEXT).toMatch(/withdraw/i);
  });

  it('is never marked counsel-reviewed by code, and keeps its open questions as TODOs', () => {
    const policy = currentConsentPolicy();
    expect(policy.counselReviewed).toBe(false);
    expect(policy.scope).toBe('self_match');
    expect(policy.text).toContain('TODO(Tyler & Sara)');
    expect(policy.version).toContain('draft');
  });
});

describe('guest-facing projection', () => {
  it('never leaks the IP hash, request id or the surface', () => {
    const described = describeConsent(row());
    expect(Object.keys(described).sort()).toEqual(['grantedAt', 'id', 'policyVersion', 'revokedAt', 'scope', 'textHash']);
    expect(JSON.stringify(described)).not.toContain('iphash');
  });
});

describe('what the consent text promises', () => {
  const policy = currentConsentPolicy();

  it('does not claim absolutes the code cannot hold', () => {
    // The old wording said "never used to identify anyone who has not opted in" and "never shared".
    // The first is now stated as what is actually guaranteed (no template for anyone else, and no
    // "who is this?" query exists); the second names the one party the template does go to.
    expect(policy.purpose).not.toMatch(/never shared\b/);
    expect(policy.purpose).toMatch(/never build or keep a face template for anyone but you/);
    expect(policy.purpose).toMatch(/no way in this website to run a face against everyone/);
    expect(policy.purpose).toMatch(/shared with that processor, and with nobody else/);
  });

  it('warns that the software looks at the whole photo, including other people', () => {
    expect(policy.purpose).toMatch(/including other people in it/);
    expect(policy.purpose).toMatch(/forbids it from keeping or reusing/);
  });

  it('says the match list exists, who can see it, and that it is deleted too', () => {
    expect(policy.results).toMatch(/list of which photos matched you/);
    expect(policy.results).toMatch(/Only you and the couple's administrators/);
    expect(policy.results).toMatch(/deleted together with everything else/);
    expect(policy.text).toContain(policy.results);
  });

  it('anchors retention where the sweep actually measures it', () => {
    // The sweep runs BIOMETRIC_RETENTION_DAYS from enrolment; the copy used to say "after the
    // archive opens", which is a different date nobody could reconcile.
    expect(policy.retention).toMatch(/12 months after you add your reference photos/);
    expect(policy.retention).not.toMatch(/after the archive opens/);
  });

  it('promises only deletion triggers that have an implementation', () => {
    expect(policy.retention).toMatch(/when your guest record is deleted/);
    expect(policy.retention).toMatch(/ask the couple to delete it for you/);
    // Supersession now deletes rather than retains, and the term clause says so.
    expect(policy.term).toMatch(/deleted rather than carried over/);
  });

  it('is a new version, so every grant given for the old wording must be given again', () => {
    expect(policy.version).toBe('2026-09-06.draft-2');
    expect(consentState([row({ policyVersion: '2026-09-05.draft-1' })], POLICY).status).toBe('superseded');
  });
});
