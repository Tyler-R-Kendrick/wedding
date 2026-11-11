import type { ServerEnv } from '@/lib/env';
import { ConnectTwilioVerify, DEFAULT_TWILIO_CONNECTOR } from './connect';
import { MockTwilioVerify } from './mock';
import { LiveTwilioVerify } from './twilio';
import { twilioVerifyConfigured, type TwilioVerifyProvider } from './types';

export * from './types';
export { MockTwilioVerify } from './mock';
export { LiveTwilioVerify } from './twilio';
export { ConnectTwilioVerify, DEFAULT_TWILIO_CONNECTOR } from './connect';

export type TwilioEnv = Pick<
  ServerEnv,
  'FORCE_MOCK_PROVIDERS' | 'TWILIO_ACCOUNT_SID' | 'TWILIO_AUTH_TOKEN' | 'TWILIO_VERIFY_SERVICE_SID' | 'TWILIO_CONNECTOR' | 'TWILIO_CONNECT_USER_ID' | 'RESEND_CONNECT_USER_ID' | 'isProduction'
>;

/** One per connector for the life of the process: it remembers what it learned about the connector. */
const g = globalThis as unknown as { __weddingTwilioConnect?: Map<string, ConnectTwilioVerify> };

/** The Vercel Connect provider for this environment (`./connect.ts`). */
export function connectTwilioVerify(env: TwilioEnv): ConnectTwilioVerify {
  const connector = env.TWILIO_CONNECTOR?.trim() || DEFAULT_TWILIO_CONNECTOR;
  const held = (g.__weddingTwilioConnect ??= new Map());
  let provider = held.get(connector);
  if (!provider) {
    provider = new ConnectTwilioVerify({ connector, userIds: [env.TWILIO_CONNECT_USER_ID, env.RESEND_CONNECT_USER_ID], serviceSid: env.TWILIO_VERIFY_SERVICE_SID });
    held.set(connector, provider);
  }
  return provider;
}

/**
 * Which Twilio this server texts through:
 *   the three TWILIO_* credentials set   Twilio directly
 *   otherwise, in production              the Vercel connector (no credential in this project)
 *   otherwise (development, test, CI)     the mock, which sends nothing
 */
export function createTwilioVerifyProvider(env: TwilioEnv): TwilioVerifyProvider {
  if (twilioVerifyConfigured(env)) return new LiveTwilioVerify(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_VERIFY_SERVICE_SID!);
  if (env.isProduction && !env.FORCE_MOCK_PROVIDERS) return connectTwilioVerify(env);
  return new MockTwilioVerify();
}
