import type { IdempotencyStore } from '@/capabilities/services';
import { FORWARDED_SUBJECT_PREFIX, GUEST_CONTACT_EMAIL, INBOUND_FORWARD_BCC } from '@/domain/contact/copy';
import { normalizeEmail } from '@/domain/identity/mask';
import { sha256Hex } from '@/lib/crypto';
import {
  downloadAttachment,
  fetchReceivedEmail,
  listReceivedAttachments,
  sendForwardedEmail,
  type ForwardOutbound,
} from './resend-api';

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface InboundForwardConfig {
  connectUserId: string;
  emailFrom: string;
  /** One or more forward destinations (from PLANNER_FORWARD_EMAIL). */
  plannerForwardEmails: readonly string[];
  guestInboxEmail?: string;
}

export interface InboundForwardDeps {
  config: InboundForwardConfig;
  nonces: IdempotencyStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export type SkipReason =
  | 'wrong_recipient'
  | 'loop_sender'
  | 'loop_subject'
  | 'auto_reply'
  | 'missing_planner'
  | 'rate_limited_sender';

export interface ForwardEventInput {
  emailId: string;
  from: string;
  to: string[];
  subject?: string | null;
  svixId: string;
}

export type SkipGuardInput = Pick<ForwardEventInput, 'from' | 'to' | 'subject'>;

function parseMailbox(raw: string): string {
  const trimmed = raw.trim();
  const angle = /<([^>]+)>/.exec(trimmed);
  return normalizeEmail(angle?.[1] ?? trimmed);
}

function headerValue(headers: Record<string, string | string[]>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return undefined;
  const v = headers[key];
  return Array.isArray(v) ? v[0] : v;
}

function isAutoReply(headers: Record<string, string | string[]>): boolean {
  const auto = headerValue(headers, 'auto-submitted');
  if (auto && !/^no$/i.test(auto.trim())) return true;
  const precedence = headerValue(headers, 'precedence');
  if (precedence && /^(bulk|junk|list|auto_reply)/i.test(precedence.trim())) return true;
  return false;
}

function blockedSenders(emailFrom: string, plannerEmails: readonly string[]): Set<string> {
  const blocked = new Set<string>([
    normalizeEmail(GUEST_CONTACT_EMAIL),
    normalizeEmail(INBOUND_FORWARD_BCC),
    parseMailbox(emailFrom),
  ]);
  for (const planner of plannerEmails) blocked.add(normalizeEmail(planner));
  return blocked;
}

export function shouldSkipForward(
  input: SkipGuardInput,
  config: InboundForwardConfig,
  headers: Record<string, string | string[]> = {},
): SkipReason | null {
  const inbox = normalizeEmail(config.guestInboxEmail ?? GUEST_CONTACT_EMAIL);
  const recipients = input.to.map(parseMailbox);
  if (!recipients.some((r) => r === inbox)) return 'wrong_recipient';

  const subject = (input.subject ?? '').trim();
  if (subject.toLowerCase().startsWith(FORWARDED_SUBJECT_PREFIX.toLowerCase())) return 'loop_subject';

  const blocked = blockedSenders(config.emailFrom, config.plannerForwardEmails);
  const sender = parseMailbox(input.from);
  if (blocked.has(sender)) return 'loop_sender';

  if (isAutoReply(headers)) return 'auto_reply';
  return null;
}

export async function forwardGuestEmail(
  deps: InboundForwardDeps,
  input: ForwardEventInput,
  senderRateKey: string,
  consumeSenderLimit: (key: string) => Promise<boolean>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { config } = deps;
  if (config.plannerForwardEmails.length === 0) return { status: 404, body: { ok: false } };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const received = await fetchReceivedEmail(config.connectUserId, input.emailId, fetchImpl);
  if (!received.ok) return { status: 502, body: { ok: false } };

  const skip = shouldSkipForward({ ...input, subject: received.value.subject ?? input.subject }, config, received.value.headers);
  if (skip) return { status: 202, body: { ok: true, ignored: skip } };

  const allowed = await consumeSenderLimit(senderRateKey);
  if (!allowed) return { status: 429, body: { ok: false, reason: 'rate_limited_sender' } };

  const nonceScope = 'inbound-mail:forward';
  const claimed = await deps.nonces.reserve(nonceScope, input.svixId, sha256Hex(input.emailId), 60 * 60);
  if (!claimed.reserved) return { status: 200, body: { ok: true, replay: true } };

  try {
    const attachments = await listReceivedAttachments(config.connectUserId, input.emailId, fetchImpl);
    const outboundAttachments: ForwardOutbound['attachments'] = [];
    if (attachments.ok) {
      for (const meta of attachments.value.slice(0, MAX_ATTACHMENTS)) {
        const file = await downloadAttachment(meta.download_url, fetchImpl);
        if (!file.ok) continue;
        if (file.value.byteLength > MAX_ATTACHMENT_BYTES) continue;
        outboundAttachments.push({
          filename: meta.filename,
          content: file.value.toString('base64'),
          content_type: meta.content_type,
        });
      }
    }

    const originalSubject = (received.value.subject ?? input.subject ?? '(no subject)').trim();
    const subject = originalSubject.toLowerCase().startsWith(FORWARDED_SUBJECT_PREFIX.toLowerCase())
      ? originalSubject
      : `${FORWARDED_SUBJECT_PREFIX} ${originalSubject}`;

    const intro = `Forwarded guest message to ${GUEST_CONTACT_EMAIL}.\n\nFrom: ${received.value.from}\nTo: ${received.value.to.join(', ')}\n\n---\n\n`;
    const textBody = received.value.text ?? '(no plain-text body)';
    const htmlBody = received.value.html
      ? `<p><strong>Forwarded guest message to ${GUEST_CONTACT_EMAIL}</strong></p><p>From: ${escapeHtml(received.value.from)}<br/>To: ${escapeHtml(received.value.to.join(', '))}</p><hr/>${received.value.html}`
      : undefined;

    const sent = await sendForwardedEmail(
      config.connectUserId,
      {
        from: config.emailFrom,
        to: [...config.plannerForwardEmails],
        bcc: [INBOUND_FORWARD_BCC],
        replyTo: received.value.from,
        subject,
        text: intro + textBody,
        html: htmlBody,
        attachments: outboundAttachments,
      },
      fetchImpl,
    );
    if (!sent.ok) {
      await deps.nonces.release(nonceScope, input.svixId);
      return { status: 502, body: { ok: false } };
    }
    await deps.nonces.set(nonceScope, input.svixId, sha256Hex(input.emailId), { messageId: sent.value.messageId }, 60 * 60);
    return { status: 200, body: { ok: true, forwarded: true, messageId: sent.value.messageId } };
  } catch {
    await deps.nonces.release(nonceScope, input.svixId);
    return { status: 500, body: { ok: false } };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
