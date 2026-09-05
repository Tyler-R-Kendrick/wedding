import { newId } from '@/contracts/ids';
import { ok } from '@/contracts/result';
import { okConfig, upHealth } from '../base';
import type { AuthEmailProvider, OtpMessage } from './types';

export interface DevInboxMessage extends OtpMessage {
  id: string;
  sentAt: string;
}

const MAX_INBOX = 200;
const g = globalThis as unknown as { __weddingDevInbox?: DevInboxMessage[] };
const inbox = (): DevInboxMessage[] => (g.__weddingDevInbox ??= []);

/** Dev inbox: in-memory, per process, non-production only (served by /api/dev/inbox). */
export const devInbox = {
  list(): DevInboxMessage[] {
    return [...inbox()].reverse();
  },
  latestFor(to: string): DevInboxMessage | undefined {
    return [...inbox()].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase());
  },
  clear(): void {
    inbox().length = 0;
  },
};

export class MockAuthEmail implements AuthEmailProvider {
  readonly kind = 'auth-email' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { sendOtp: true };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth('dev inbox');
  }
  async sendOtp(message: OtpMessage) {
    const id = newId();
    const box = inbox();
    box.push({ ...message, id, sentAt: new Date().toISOString() });
    if (box.length > MAX_INBOX) box.splice(0, box.length - MAX_INBOX);
    return ok({ messageId: id });
  }
}
