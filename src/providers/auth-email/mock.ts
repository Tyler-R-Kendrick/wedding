import { newId } from '@/contracts/ids';
import { ok } from '@/contracts/result';
import { okConfig, upHealth } from '../base';
import type { AuthEmailProvider, OtpMessage, PlainMessage } from './types';

export type DevInboxMessage = { id: string; sentAt: string } & (({ kind: 'otp' } & OtpMessage) | ({ kind: 'message' } & PlainMessage));

const MAX_INBOX = 200;
const g = globalThis as unknown as { __weddingDevInbox?: DevInboxMessage[] };
const inbox = (): DevInboxMessage[] => (g.__weddingDevInbox ??= []);

/** Dev inbox: in-memory, per process, non-production only (served by /api/dev/inbox). */
export const devInbox = {
  list(): DevInboxMessage[] {
    return [...inbox()].reverse();
  },
  /** Latest one-time code for an address. */
  latestFor(to: string): (DevInboxMessage & { kind: 'otp' }) | undefined {
    return [...inbox()].reverse().find((m): m is DevInboxMessage & { kind: 'otp' } => m.kind === 'otp' && m.to.toLowerCase() === to.toLowerCase());
  },
  /** Latest plain message for an address (RSVP confirmations etc.). */
  latestMessageFor(to: string): (DevInboxMessage & { kind: 'message' }) | undefined {
    return [...inbox()].reverse().find((m): m is DevInboxMessage & { kind: 'message' } => m.kind === 'message' && m.to.toLowerCase() === to.toLowerCase());
  },
  clear(): void {
    inbox().length = 0;
  },
};

export class MockAuthEmail implements AuthEmailProvider {
  readonly kind = 'auth-email' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { sendOtp: true, sendMessage: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth('dev inbox');
  }
  async sendOtp(message: OtpMessage) {
    return this.push({ kind: 'otp', ...message });
  }
  async sendMessage(message: PlainMessage) {
    return this.push({ kind: 'message', ...message });
  }
  private push(entry: ({ kind: 'otp' } & OtpMessage) | ({ kind: 'message' } & PlainMessage)) {
    const id = newId();
    const box = inbox();
    box.push({ ...entry, id, sentAt: new Date().toISOString() });
    if (box.length > MAX_INBOX) box.splice(0, box.length - MAX_INBOX);
    return ok({ messageId: id });
  }
}
