import { describe, expect, it, vi } from 'vitest';
import { MemoryIdempotencyStore } from '@/capabilities/services';
import { handleResendInboundWebhook } from '@/domain/inbound-mail/webhook';
import { signSvixPayload } from '@/lib/svix-webhook';
import { MemoryRateLimit } from '@/providers/rate-limit/memory';

vi.mock('@vercel/connect', () => ({ getToken: vi.fn(async () => 'token_test') }));

const SECRET = 'whsec_' + Buffer.from('integration-inbound-secret-32b!!').toString('base64');

describe('Resend inbound forward', () => {
  it('returns 404 when forwarding is not configured', async () => {
    const result = await handleResendInboundWebhook(
      {
        webhookSecret: SECRET,
        config: { connectUserId: 'user_test', emailFrom: 'Sara + Tyler <hello@kendrick.wedding>', plannerForwardEmail: '' },
        nonces: new MemoryIdempotencyStore(),
        limiter: new MemoryRateLimit(),
      },
      '{}',
      { svixId: 'x', svixTimestamp: String(Math.floor(Date.now() / 1000)), svixSignature: 'v1,abc' },
      'direct',
    );
    expect(result.status).toBe(404);
  });

  it('forwards a received email to the planner with attachments', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/emails/receiving/email_abc') && !url.includes('attachments')) {
        return Response.json({
          id: 'email_abc',
          from: 'Guest <guest@example.test>',
          to: ['hello@kendrick.wedding'],
          subject: 'Need my link',
          text: 'Please help',
          html: '<p>Please help</p>',
          headers: {},
        });
      }
      if (url.includes('/attachments')) {
        return Response.json({
          data: [{ id: 'att1', filename: 'note.txt', content_type: 'text/plain', download_url: 'https://cdn.example.test/a1' }],
        });
      }
      if (url === 'https://cdn.example.test/a1') {
        return new Response('hello file', { status: 200 });
      }
      if (url === 'https://api.resend.com/emails' && init?.method === 'POST') {
        return Response.json({ id: 'sent_123' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const body = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'email_abc', from: 'guest@example.test', to: ['hello@kendrick.wedding'], subject: 'Need my link' },
    });
    const id = 'msg_integration_2';
    const ts = Math.floor(Date.now() / 1000);

    const result = await handleResendInboundWebhook(
      {
        webhookSecret: SECRET,
        config: {
          connectUserId: 'user_test',
          emailFrom: 'Sara + Tyler <hello@kendrick.wedding>',
          plannerForwardEmail: 'planner@example.test',
        },
        nonces: new MemoryIdempotencyStore(),
        limiter: new MemoryRateLimit(),
        fetchImpl: fetchImpl as typeof fetch,
      },
      body,
      { svixId: id, svixTimestamp: String(ts), svixSignature: signSvixPayload(SECRET, id, ts, body) },
      'direct',
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, forwarded: true, messageId: 'sent_123' });
    const sendCall = fetchImpl.mock.calls.find((c) => String(c[0]) === 'https://api.resend.com/emails');
    expect(sendCall).toBeDefined();
    const payload = JSON.parse(String((sendCall?.[1] as RequestInit).body));
    expect(payload).toMatchObject({
      to: ['planner@example.test'],
      bcc: ['contact.tylerkendrick@gmail.com'],
      reply_to: 'Guest <guest@example.test>',
      subject: '[kendrick.wedding] Need my link',
    });
  });
});
