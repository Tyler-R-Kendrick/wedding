import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { connectTwilioVerify, twilioVerifyConfigured } from '@/providers/twilio-verify';

/**
 * Can a guest sign in by text right now? Yes wherever a text can be sent:
 *
 *   development, test, CI     always: the mock stands in for Twilio
 *   production                when the three TWILIO_* credentials are set, or the Vercel connector
 *                             for Twilio answers (`src/providers/twilio-verify/connect.ts`)
 *
 * There is no switch to turn it on. The connector is asked, not assumed: a yes is kept for ten
 * minutes and a no for one, so the option appears on the sign-in page within a minute of the
 * connector being connected, with no deploy, and a sign-in page never waits long on the answer.
 */
const YES_MS = 10 * 60_000;
const NO_MS = 60_000;
const WAIT_MS = 3_000;

type Held = { ok: boolean; until: number };
const g = globalThis as unknown as { __weddingPhoneSignIn?: { held?: Held; asking?: Promise<boolean> } };
const state = () => (g.__weddingPhoneSignIn ??= {});

export async function isPhoneSignInAvailable(now: number = Date.now()): Promise<boolean> {
  if (twilioVerifyConfigured(env)) return true;
  if (!env.isProduction) return true;
  if (env.FORCE_MOCK_PROVIDERS) return false;
  const s = state();
  if (s.held && s.held.until > now) return s.held.ok;
  s.asking ??= (async () => {
    try {
      const ready = await connectTwilioVerify(env).ready();
      s.held = { ok: ready.ok, until: Date.now() + (ready.ok ? YES_MS : NO_MS) };
      // The reason is the connector's own error (its kind and code), never a credential.
      if (!ready.ok) logger.warn({ reason: ready.reason }, 'phone sign-in is off: the Twilio connector cannot send');
      return ready.ok;
    } finally {
      s.asking = undefined;
    }
  })();
  // Whoever asked first is still answered in full; this request stops waiting for it.
  return Promise.race([s.asking, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), WAIT_MS))]);
}

/** Tests: forget what the connector last said. */
export function resetPhoneSignInAvailability(): void {
  g.__weddingPhoneSignIn = {};
}
