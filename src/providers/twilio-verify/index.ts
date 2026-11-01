import type { ServerEnv } from '@/lib/env';
import { MockTwilioVerify } from './mock';
import { LiveTwilioVerify } from './twilio';
import type { TwilioVerifyProvider } from './types';

export * from './types';
export { MockTwilioVerify } from './mock';
export { LiveTwilioVerify } from './twilio';

export function createTwilioVerifyProvider(
  env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_VERIFY_SERVICE_SID'>,
): TwilioVerifyProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID) {
    return new LiveTwilioVerify(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_VERIFY_SERVICE_SID);
  }
  return new MockTwilioVerify();
}
