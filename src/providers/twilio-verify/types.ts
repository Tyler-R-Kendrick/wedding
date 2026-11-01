import type { ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import { DEFAULT_CALL_POLICY, type CallPolicy } from '@/contracts/providers';
import type { ServerEnv } from '@/lib/env';

export interface TwilioVerifySendInput {
  to: string;
  /** Optional custom message suffix (e.g. short magic link) when the Verify service allows. */
  customMessage?: string;
}

export interface TwilioVerifyCheckInput {
  to: string;
  code: string;
}

export interface TwilioVerifySendResult {
  sid: string;
  status: string;
}

export interface TwilioVerifyProvider extends ProviderDescriptor {
  kind: 'twilio-verify';
  policy: CallPolicy;
  startVerification(input: TwilioVerifySendInput): Promise<{ ok: true; value: TwilioVerifySendResult } | { ok: false; error: ProviderFailure }>;
  checkVerification(input: TwilioVerifyCheckInput): Promise<{ ok: true } | { ok: false; error: ProviderFailure }>;
}

export function twilioVerifyConfigured(env: Pick<ServerEnv, 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_VERIFY_SERVICE_SID' | 'FORCE_MOCK_PROVIDERS'>): boolean {
  if (env.FORCE_MOCK_PROVIDERS) return false;
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID);
}

export const TWILIO_VERIFY_POLICY = DEFAULT_CALL_POLICY;
