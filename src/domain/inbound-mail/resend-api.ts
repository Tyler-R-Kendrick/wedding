import { getToken } from '@vercel/connect';
import { err, ok, type Result } from '@/contracts/result';
import { failure } from '@/providers/base';

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string | string[]>;
}

export interface ReceivedAttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
  download_url: string;
}

export interface OutboundAttachment {
  filename: string;
  content: string;
  content_type?: string;
}

export interface ForwardOutbound {
  from: string;
  to: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  text: string;
  html?: string;
  attachments: OutboundAttachment[];
}

type FetchImpl = typeof fetch;

async function bearer(connectUserId: string): Promise<Result<string, ReturnType<typeof failure>>> {
  try {
    const token = await getToken('resend/wedding', { subject: { type: 'user', id: connectUserId } });
    return ok(token);
  } catch (e) {
    return err(failure('resend', 'auth', 'Email service is not available right now.', { raw: e }));
  }
}

export async function fetchReceivedEmail(
  connectUserId: string,
  emailId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<ReceivedEmail, ReturnType<typeof failure>>> {
  const token = await bearer(connectUserId);
  if (!token.ok) return token;
  const res = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${token.value}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return err(failure('resend', res.status >= 500 ? 'server' : 'bad_request', 'Could not load the received email.'));
  const body = (await res.json()) as Record<string, unknown>;
  return ok({
    id: String(body.id ?? emailId),
    from: String(body.from ?? ''),
    to: Array.isArray(body.to) ? body.to.map(String) : [],
    subject: typeof body.subject === 'string' ? body.subject : null,
    text: typeof body.text === 'string' ? body.text : null,
    html: typeof body.html === 'string' ? body.html : null,
    headers: (body.headers && typeof body.headers === 'object' ? body.headers : {}) as Record<string, string | string[]>,
  });
}

export async function listReceivedAttachments(
  connectUserId: string,
  emailId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<ReceivedAttachmentMeta[], ReturnType<typeof failure>>> {
  const token = await bearer(connectUserId);
  if (!token.ok) return token;
  const res = await fetchImpl(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
    headers: { Authorization: `Bearer ${token.value}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return err(failure('resend', res.status >= 500 ? 'server' : 'bad_request', 'Could not list attachments.'));
  const body = (await res.json()) as { data?: unknown[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  return ok(
    rows
      .map((row) => {
        const r = row as Record<string, unknown>;
        if (typeof r.download_url !== 'string' || typeof r.filename !== 'string') return null;
        return {
          id: String(r.id ?? r.filename),
          filename: r.filename,
          content_type: typeof r.content_type === 'string' ? r.content_type : 'application/octet-stream',
          download_url: r.download_url,
        };
      })
      .filter((v): v is ReceivedAttachmentMeta => v !== null),
  );
}

export async function downloadAttachment(
  downloadUrl: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<Buffer, ReturnType<typeof failure>>> {
  const res = await fetchImpl(downloadUrl, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return err(failure('resend', 'network', 'Could not download an attachment.'));
  return ok(Buffer.from(await res.arrayBuffer()));
}

export async function sendForwardedEmail(
  connectUserId: string,
  message: ForwardOutbound,
  fetchImpl: FetchImpl = fetch,
): Promise<Result<{ messageId: string }, ReturnType<typeof failure>>> {
  const token = await bearer(connectUserId);
  if (!token.ok) return token;
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      bcc: message.bcc,
      reply_to: message.replyTo,
      subject: message.subject.slice(0, 200),
      text: message.text.slice(0, 100_000),
      html: message.html?.slice(0, 200_000),
      attachments: message.attachments.map((a) => ({
        filename: a.filename.slice(0, 200),
        content: a.content,
        content_type: a.content_type,
      })),
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 429) return err(failure('resend', 'rate_limited', 'Too many emails right now.', { retryAfterMs: 30_000 }));
  if (!res.ok) return err(failure('resend', res.status >= 500 ? 'server' : 'bad_request', 'Could not forward the email.'));
  const body = (await res.json()) as { id?: string };
  if (!body.id) return err(failure('resend', 'server', 'Could not forward the email.'));
  return ok({ messageId: body.id });
}
