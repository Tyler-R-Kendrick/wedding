import { describe, expect, it } from 'vitest';
import { adminEnableBiometricReadiness } from '@/capabilities/biometrics';

describe('spot checks for claims in findings.md', () => {
  /**
   * FINDING 5 (fixed). ORIGINAL ASSERTION: `expect(parse('asd').success).toBe(true)` — the point
   * of the spot check was to confirm findings.md's claim that a three-character string opened the
   * Illinois BIPA readiness gate. That assertion pins the defect and inverts by construction once
   * the schema is tightened, so it now asserts the property the finding asked for: a placeholder
   * is rejected, and a reference someone can actually go and read is accepted. The blank and
   * whitespace-only cases are unchanged.
   */
  it('counselReviewRef: blanks and placeholders are rejected, a real reference is accepted', () => {
    // (`admin_set_biometric_readiness` was split into enable/disable so the OFF switch can never
    // need a confirmation token; the schema under test is the same one, on the enable path.)
    const parse = (v: unknown) => adminEnableBiometricReadiness.input.safeParse({ counselReviewRef: v });
    console.info('[spot] "" -> %s | "   " -> %s | " a " -> %s | "asd" -> %s | "ADR-0006 §7 addendum" -> %s',
      parse('').success, parse('   ').success, parse(' a ').success, parse('asd').success, parse('ADR-0006 §7 addendum, filed 2027-01-14').success);
    expect(parse('').success).toBe(false);
    expect(parse('   ').success).toBe(false);
    expect(parse(' a ').success).toBe(false);
    expect(parse('asd').success).toBe(false);
    expect(parse('placeholder!!').success).toBe(false);
    for (const good of [
      'ADR-0006 §7 addendum, filed 2027-01-14',
      'https://example.invalid/reviews/bipa-2027-01-14.pdf',
      'LEGAL-1421 counsel review memo',
      'counsel review memo of 2027-01-14',
    ]) {
      expect(parse(good).success, good).toBe(true);
    }
  });
});
