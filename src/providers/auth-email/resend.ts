import { err, ok } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import type { AuthEmailProvider, OtpMessage, PlainMessage } from './types';

/**
 * Resend adapter (HTTPS API, no SDK). Selected when RESEND_API_KEY and EMAIL_FROM are set.
 * Copy is intentionally plain; the auth swarm owns the final template.
 */
export class ResendAuthEmail implements AuthEmailProvider {
  readonly kind = 'auth-email' as const;
  readonly name = 'resend';
  readonly mode = 'live' as const;
  readonly capabilities = { sendOtp: true, sendMessage: true };
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetchImpl: typeof fetch = fetch) {}

  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }

  async sendOtp(message: OtpMessage) {
    const minutes = message.expiresInMinutes ?? 10;
    const subject = message.purpose === 'step_up' ? 'Confirm it is you' : 'Your sign-in code';
    const text = `Your code is ${message.code}. It expires in ${minutes} minutes. If you did not request this, you can ignore this email.`;
    return this.deliver(message.to, subject, text);
  }

  async sendMessage(message: PlainMessage) {
    return this.deliver(message.to, message.subject.slice(0, 200), message.text.slice(0, 20_000));
  }

  private async deliver(to: string, subject: string, text: string) {
    try {
      const res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject, text }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 429) return err(failure(this.name, 'rate_limited', 'Too many emails right now. Please try again shortly.', { retryAfterMs: 30_000 }));
      if (res.status === 401 || res.status === 403) return err(failure(this.name, 'auth', 'Email service is not available right now.'));
      if (!res.ok) return err(failure(this.name, res.status >= 500 ? 'server' : 'bad_request', 'We could not send your code. Please try again.'));
      const body = (await res.json()) as { id?: string };
      return ok({ messageId: body.id ?? 'unknown' });
    } catch (e) {
      const cls = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network';
      return err(failure(this.name, cls, 'We could not send your code. Please try again.', { raw: e }));
    }
  }
}
