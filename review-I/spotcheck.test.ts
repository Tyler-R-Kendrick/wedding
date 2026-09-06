import { describe, expect, it } from 'vitest';
import { adminSetBiometricReadiness } from '@/capabilities/biometrics';

describe('spot checks for claims in findings.md', () => {
  it('counselReviewRef: blank and whitespace-only are rejected, "asd" is not', () => {
    const parse = (v: unknown) => adminSetBiometricReadiness.input.safeParse({ ready: true, counselReviewRef: v });
    console.info('[spot] "" -> %s | "   " -> %s | " a " -> %s | "asd" -> %s | "  asd  " -> %s',
      parse('').success, parse('   ').success, parse(' a ').success, parse('asd').success, parse('  asd  ').success);
    expect(parse('').success).toBe(false);
    expect(parse('   ').success).toBe(false);
    expect(parse(' a ').success).toBe(false);
    expect(parse('asd').success).toBe(true);
  });
});
