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

describe('normalizePhoneE164', () => {
  it('normalizes US numbers to E.164', () => {
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
