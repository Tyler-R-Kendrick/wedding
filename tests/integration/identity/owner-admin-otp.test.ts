import { describe, expect, it } from 'vitest';
import { call, expectOk, grantAdmin } from './harness';

describe('owner administrator OTP (production regression)', () => {
  it('accepts request_otp for contact.tylerkendrick@gmail.com when they are an administrator', async () => {
    await grantAdmin('contact.tylerkendrick@gmail.com', 'owner');
    const sent = expectOk(
      await call<{ sent: boolean }>('request_otp', { purpose: 'sign_in', email: 'contact.tylerkendrick@gmail.com' }, { ip: '10.9.9.10' }),
    );
    expect(sent.data.sent).toBe(true);
  });
});
