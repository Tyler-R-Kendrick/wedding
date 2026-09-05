import { sha256Hex } from '@/lib/crypto';

/**
 * The consent policy shown to a guest before any face processing. Versioned: a guest's consent
 * is bound to the exact text (hash) they saw, and a new version invalidates old grants.
 *
 * NOT LEGAL ADVICE. This copy is an engineering draft in the couple's voice; it MUST be reviewed
 * by Illinois-licensed privacy counsel (740 ILCS 14, "BIPA") before FLAG_BIOMETRICS_ENABLED is
 * ever turned on in production (ADR-0006 §7). Every `TODO(Tyler & Sara)` is a fact only the
 * couple or counsel can supply; none is invented here.
 */
export const CONSENT_POLICY_VERSION = '2026-09-05.draft-1';

export const CONSENT_SCOPE_LABEL = 'Find photos of yourself only (self-match).';

export const CONSENT_PURPOSE =
  'Purpose: to let you find the wedding photos you appear in. Your face template is compared only against photos you choose, ' +
  'and only to answer the question "am I in this one?". It is never used for anything else, never shared, and never used to identify anyone who has not opted in.';

export const CONSENT_TERM =
  'Term: from the moment you agree until you withdraw consent, request deletion, or the archive closes ' +
  '(TODO(Tyler & Sara): confirm the closing date with counsel).';

export const CONSENT_RETENTION =
  'Retention and deletion: your face template and match results are deleted when you withdraw consent, when you ask us to, ' +
  'when your guest record is deleted, or at the latest 12 months after the archive opens (TODO(Tyler & Sara): counsel to confirm the retention schedule), ' +
  'whichever comes first. Deletion is permanent and produces a written deletion record you can see on this page.';

export const CONSENT_PROVIDER_DISCLOSURE =
  'Who processes it: TODO(Tyler & Sara): the face-matching provider (or on-device/in-VPC processing) and its data processing agreement have not been chosen. ' +
  'Until then this feature runs only in development with a mock that detects nothing. Photos taken by Brooke Alaina Photography or Oakhouse Visuals ' +
  'are never sent to any third-party service without their written confirmation.';

export const CONSENT_MINORS = 'You must be 18 or older to opt in. Children are never enrolled; a guardian-consent design is pending separate review.';

/** The exact text presented and hashed. Rendered verbatim on the opt-in page. */
export const CONSENT_TEXT = [
  `Face matching consent (version ${CONSENT_POLICY_VERSION}).`,
  'By agreeing you allow the wedding website to create one biometric identifier (a numeric face template) from photos you pick of yourself, and to store it in an isolated, encrypted vault.',
  CONSENT_SCOPE_LABEL,
  CONSENT_PURPOSE,
  CONSENT_TERM,
  CONSENT_RETENTION,
  CONSENT_PROVIDER_DISCLOSURE,
  CONSENT_MINORS,
  'You can withdraw at any time from this page ("Withdraw consent") or ask for immediate deletion ("Delete my facial data"). Nothing about this choice affects any other part of the wedding.',
].join('\n\n');

export function consentTextHash(text: string = CONSENT_TEXT): string {
  return sha256Hex(text);
}

export const CONSENT_TEXT_HASH = consentTextHash();

export interface ConsentPolicy {
  version: string;
  textHash: string;
  text: string;
  scope: 'self_match';
  purpose: string;
  term: string;
  retention: string;
  providerDisclosure: string;
  minors: string;
  counselReviewed: false;
}

export function currentConsentPolicy(): ConsentPolicy {
  return {
    version: CONSENT_POLICY_VERSION,
    textHash: CONSENT_TEXT_HASH,
    text: CONSENT_TEXT,
    scope: 'self_match',
    purpose: CONSENT_PURPOSE,
    term: CONSENT_TERM,
    retention: CONSENT_RETENTION,
    providerDisclosure: CONSENT_PROVIDER_DISCLOSURE,
    minors: CONSENT_MINORS,
    counselReviewed: false,
  };
}
