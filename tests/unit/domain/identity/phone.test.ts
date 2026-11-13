import { describe, expect, it } from 'vitest';
import { maskPhone, normalizePhoneE164, phoneAuthEmail } from '@/domain/identity/phone';
import { MockTwilioVerify } from '@/providers/twilio-verify/mock';

describe('MockTwilioVerify', () => {
  it('stages and consumes a code', () => {
    MockTwilioVerify.clearPending();
    MockTwilioVerify.stage('+15551230001');
    expect(MockTwilioVerify.consume('+15551230001', '000000').ok).toBe(true);
    expect(MockTwilioVerify.consume('+15551230001', '000000').ok).toBe(false);
  });
});

/** NANP 555-01XX reserved for fiction (G3 — not a real subscriber number). */
const RUBRIC_FICTION = '+15550100067';

describe('normalizePhoneE164', () => {
  it('P-01: (555) 010-0067 normalizes to E.164 +15550100067', () => {
    expect(normalizePhoneE164('(555) 010-0067')).toBe(RUBRIC_FICTION);
  });

  it('P-02: 555.010.0067 normalizes to the same E.164', () => {
    expect(normalizePhoneE164('555.010.0067')).toBe(RUBRIC_FICTION);
  });

  it('P-03: +1 555 010 0067 normalizes to the same E.164', () => {
    expect(normalizePhoneE164('+1 555 010 0067')).toBe(RUBRIC_FICTION);
  });

  it('P-04: 1-555-010-0067 normalizes to the same E.164', () => {
    expect(normalizePhoneE164('1-555-010-0067')).toBe(RUBRIC_FICTION);
  });

  it('P-05: international +44 numbers stay E.164 when valid', () => {
    expect(normalizePhoneE164('+44 7911 123456')).toBe('+447911123456');
  });

  it('P-06: extension suffixes are not supported', () => {
    expect(normalizePhoneE164('555-010-0067 x123')).toBeNull();
    expect(normalizePhoneE164('555-010-0067 ext 5')).toBeNull();
  });

  it('normalizes other US numbers to E.164', () => {
    expect(normalizePhoneE164('(555) 123-4567')).toBe('+15551234567');
    expect(normalizePhoneE164('5551234567')).toBe('+15551234567');
    expect(normalizePhoneE164('+1 555 123 4567')).toBe('+15551234567');
  });

  it('rejects garbage', () => {
    expect(normalizePhoneE164('123')).toBeNull();
    expect(normalizePhoneE164('')).toBeNull();
  });
});

describe('maskPhone', () => {
  it('masks US numbers for display', () => {
    expect(maskPhone('+15551234567')).toBe('(555) •••-4567');
  });
});

describe('phoneAuthEmail', () => {
  it('is stable for auth user creation', () => {
    expect(phoneAuthEmail('+15551234567')).toBe('phone+15551234567@signin.kendrick.wedding');
  });
});
