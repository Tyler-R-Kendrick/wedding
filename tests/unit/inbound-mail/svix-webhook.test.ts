import { describe, expect, it } from 'vitest';
import { signSvixPayload, verifySvixWebhook } from '@/lib/svix-webhook';

const SECRET = 'whsec_' + Buffer.from('inbound-test-secret-key-32bytes!!').toString('base64');

describe('verifySvixWebhook', () => {
  it('accepts a correctly signed payload within the tolerance window', () => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });
    const now = 1_700_000_000_000;
    const ts = Math.floor(now / 1000);
    const id = 'msg_test_123';
    const signature = signSvixPayload(SECRET, id, ts, payload);
    const result = verifySvixWebhook(payload, { id, timestamp: String(ts), signature }, SECRET, now);
    expect(result).toEqual({ ok: true });
  });

  it('rejects tampered bodies and stale timestamps', () => {
    const payload = JSON.stringify({ type: 'email.received' });
    const ts = Math.floor(Date.now() / 1000);
    const id = 'msg_test_456';
    const signature = signSvixPayload(SECRET, id, ts, payload);
    expect(verifySvixWebhook(`${payload}x`, { id, timestamp: String(ts), signature }, SECRET).ok).toBe(false);
    expect(verifySvixWebhook(payload, { id, timestamp: String(ts - 600), signature }, SECRET).ok).toBe(false);
  });
});
