import { describe, expect, it } from 'vitest';
import { phoneCodeApproved, withApprovedPhoneCode } from '@/lib/auth/phone-approval';

describe('a phone code approved once', () => {
  it('is approved only inside the call that checked it, for that number and code', async () => {
    expect(phoneCodeApproved('+13125550100', '123456')).toBe(false);
    await withApprovedPhoneCode('+13125550100', '123456', async () => {
      await Promise.resolve();
      expect(phoneCodeApproved('+13125550100', '123456')).toBe(true);
      expect(phoneCodeApproved('(312) 555-0100', '123456')).toBe(true);
      expect(phoneCodeApproved('+13125550100', '654321')).toBe(false);
      expect(phoneCodeApproved('+13125550199', '123456')).toBe(false);
    });
    expect(phoneCodeApproved('+13125550100', '123456')).toBe(false);
  });
});
