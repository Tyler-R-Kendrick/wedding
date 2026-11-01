import type { ConfigValidation, ProviderFailure, ProviderHealth } from '@/contracts/providers';
import type { TwilioVerifyProvider, TwilioVerifySendInput, TwilioVerifyCheckInput } from './types';
import { TWILIO_VERIFY_POLICY } from './types';

const g = globalThis as unknown as { __weddingMockTwilioPending?: Map<string, string> };
const pending = () => (g.__weddingMockTwilioPending ??= new Map<string, string>());

function pendingKey(to: string): string {
  return to.replace(/\s/g, '');
}

/** In-memory Verify: codes are always `000000` in test/dev; never calls the network. */
export class MockTwilioVerify implements TwilioVerifyProvider {
  kind = 'twilio-verify' as const;
  name = 'mock';
  mode = 'mock' as const;
  capabilities = { start: true, check: true };
  policy = TWILIO_VERIFY_POLICY;

  validateConfig(): ConfigValidation {
    return { ok: true, missing: [], warnings: ['Twilio Verify mock: SMS codes are not sent; use 000000 in tests.'] };
  }

  async health(): Promise<ProviderHealth> {
    return { status: 'up', checkedAt: new Date().toISOString(), detail: 'mock twilio verify' };
  }

  async startVerification(input: TwilioVerifySendInput) {
    MockTwilioVerify.stage(input.to);
    return { ok: true as const, value: { sid: 'VEmock', status: 'pending' } };
  }

  async checkVerification(input: TwilioVerifyCheckInput) {
    const result = MockTwilioVerify.consume(input.to, input.code);
    return result.ok ? { ok: true as const } : result;
  }

  static stage(to: string) {
    pending().set(pendingKey(to), '000000');
  }

  static clearPending() {
    pending().clear();
  }

  static consume(to: string, code: string): { ok: true } | { ok: false; error: ProviderFailure } {
    const expected = pending().get(pendingKey(to));
    if (!expected || code !== expected) {
      return { ok: false, error: { provider: 'mock', class: 'bad_request' as const, message: 'Invalid code.' } };
    }
    pending().delete(pendingKey(to));
    return { ok: true };
  }
}
