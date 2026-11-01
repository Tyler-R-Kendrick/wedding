import { getFlags } from '@/lib/flags';
import { env } from '@/lib/env';
import { twilioVerifyConfigured } from '@/providers/twilio-verify/types';

/** SMS sign-in when the flag is on and Twilio is configured (production) or mock is allowed (non-production). */
export function isPhoneSignInAvailable(source: Record<string, string | undefined> = process.env): boolean {
  if (!getFlags(source).PHONE_SIGN_IN) return false;
  if (twilioVerifyConfigured({
    FORCE_MOCK_PROVIDERS: env.FORCE_MOCK_PROVIDERS,
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    TWILIO_VERIFY_SERVICE_SID: env.TWILIO_VERIFY_SERVICE_SID,
  })) return true;
  return !env.isProduction;
}
