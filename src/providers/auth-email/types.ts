import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

export type OtpPurpose = 'sign_in' | 'step_up' | 'bind_identity' | 'admin_sign_in';

export interface OtpMessage {
  to: string;
  /** The one-time code. Never logged; the mock keeps it only in the dev inbox. */
  code: string;
  purpose: OtpPurpose;
  /** Minutes until the code expires (for the email copy). */
  expiresInMinutes?: number;
}

/** Plain transactional email (RSVP confirmations, notices). Never carries codes or other guests' data. */
export interface PlainMessage {
  to: string;
  subject: string;
  text: string;
}

export interface AuthEmailProvider extends ProviderDescriptor {
  kind: 'auth-email';
  sendOtp(message: OtpMessage): Promise<Result<{ messageId: string }, ProviderFailure>>;
  sendMessage(message: PlainMessage): Promise<Result<{ messageId: string }, ProviderFailure>>;
}
