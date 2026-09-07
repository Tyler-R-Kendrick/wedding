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
export const CONSENT_POLICY_VERSION = '2026-09-06.draft-2';

export const CONSENT_SCOPE_LABEL = 'Find photos of yourself only (self-match).';

export const CONSENT_PURPOSE =
  'Purpose: to let you find the wedding photos you appear in. Your face template is compared only against photos you choose, ' +
  'and only to answer the question "am I in this one?". We never build or keep a face template for anyone but you, and we never ' +
  'ask "who is this?" — there is no way in this website to run a face against everyone. Two things you should know rather than ' +
  'have to assume: to answer "are you in this photo", the software has to look at the whole photo, including other people in it ' +
  '(nothing about them is kept, and the processor we choose will be under a contract that forbids it from keeping or reusing ' +
  'anything it sees); and your template is shared with that processor, and with nobody else.';

export const CONSENT_TERM =
  'Term: from the moment you agree until you withdraw consent, request deletion, or the archive closes ' +
  '(TODO(Tyler & Sara): confirm the closing date with counsel). If we ever change the wording on this page, your agreement ' +
  'to this version ends there: nothing further is processed, and what we hold is deleted rather than carried over. If you ' +
  'still want the feature, you will be asked to read the new wording and agree again.';

export const CONSENT_RETENTION =
  'Retention and deletion: your face template and your match list are deleted when you withdraw consent, when you ask us to, ' +
  'when your guest record is deleted, when this wording changes, or at the latest 12 months after you add your reference photos ' +
  '(TODO(Tyler & Sara): counsel to confirm the retention schedule), whichever comes first. You can also ask the couple to delete ' +
  'it for you, by email or in person, and they can do it from their side. Deletion is permanent and produces a written deletion ' +
  'record you can see on this page, listing what was destroyed.';

export const CONSENT_PROVIDER_DISCLOSURE =
  'Who processes it: TODO(Tyler & Sara): the face-matching provider (or on-device/in-VPC processing) and its data processing agreement have not been chosen. ' +
  'Until then this feature runs only in development with a mock that detects nothing, and nothing about your face leaves this website because ' +
  'there is nowhere for it to go. When a processor is chosen, this page will name it and you will be asked to agree again. Photos taken by ' +
  'Brooke Alaina Photography or Oakhouse Visuals are never sent to any third-party service without their written confirmation.';

export const CONSENT_MINORS = 'You must be 18 or older to opt in. Children are never enrolled; a guardian-consent design is pending separate review.';

/**
 * The match list is arguably more sensitive over time than the template — it is a durable,
 * queryable record of which photographs a named person appears in — and the notice said nothing
 * about it existing. It does now.
 */
export const CONSENT_RESULTS =
  'What we keep afterwards: when you run a check, we store the list of which photos matched you (the photo, a score, and when). ' +
  'Only you and the couple\'s administrators can see that list, it is never shown to other guests, and it is deleted together with ' +
  'everything else the moment you withdraw or ask us to delete. We do not keep a copy of the photos you checked, or of anyone else\'s face.';

/** The exact text presented and hashed. Rendered verbatim on the opt-in page. */
export const CONSENT_TEXT = [
  `Face matching consent (version ${CONSENT_POLICY_VERSION}).`,
  'By agreeing you allow the wedding website to create one biometric identifier (a numeric face template) from photos you pick of yourself, and to store it in an isolated, encrypted vault.',
  CONSENT_SCOPE_LABEL,
  CONSENT_PURPOSE,
  CONSENT_TERM,
  CONSENT_RETENTION,
  CONSENT_RESULTS,
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
  /** What is kept after a check, and who can see it. */
  results: string;
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
    results: CONSENT_RESULTS,
    providerDisclosure: CONSENT_PROVIDER_DISCLOSURE,
    minors: CONSENT_MINORS,
    counselReviewed: false,
  };
}
