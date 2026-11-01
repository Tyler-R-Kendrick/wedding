import type { ConfigValidation, ProviderFailure, ProviderHealth } from '@/contracts/providers';
import type { TwilioVerifyCheckInput, TwilioVerifyProvider, TwilioVerifySendInput } from './types';
import { TWILIO_VERIFY_POLICY } from './types';

const base = (sid: string) => `https://verify.twilio.com/v2/Services/${encodeURIComponent(sid)}`;

function authHeader(accountSid: string, token: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${token}`, 'utf8').toString('base64')}`;
}

function classify(status: number, _body: unknown): ProviderFailure['class'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'malformed_response';
}

export class LiveTwilioVerify implements TwilioVerifyProvider {
  kind = 'twilio-verify' as const;
  name = 'twilio-verify';
  mode = 'live' as const;
  capabilities = { start: true, check: true };
  policy = TWILIO_VERIFY_POLICY;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly serviceSid: string,
  ) {}

  validateConfig(): ConfigValidation {
    return { ok: true, missing: [], warnings: [] };
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const res = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(this.serviceSid)}`, {
        headers: { Authorization: authHeader(this.accountSid, this.authToken) },
        signal: AbortSignal.timeout(this.policy.timeoutMs),
      });
      return {
        status: res.ok ? 'up' : 'degraded',
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        detail: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e) {
      return { status: 'down', checkedAt: new Date().toISOString(), detail: e instanceof Error ? e.message : 'error' };
    }
  }

  async startVerification(input: TwilioVerifySendInput) {
    const body = new URLSearchParams({ To: input.to, Channel: 'sms' });
    if (input.customMessage?.trim()) body.set('CustomFriendlyName', input.customMessage.trim().slice(0, 32));
    return this.post(`${base(this.serviceSid)}/Verifications`, body);
  }

  async checkVerification(input: TwilioVerifyCheckInput) {
    const body = new URLSearchParams({ To: input.to, Code: input.code });
    const res = await this.post(`${base(this.serviceSid)}/VerificationCheck`, body);
    if (!res.ok) return res;
    return { ok: true as const };
  }

  private async post(url: string, body: URLSearchParams): Promise<{ ok: true; value: { sid: string; status: string } } | { ok: false; error: ProviderFailure }> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader(this.accountSid, this.authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(this.policy.timeoutMs),
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
      if (!res.ok) {
        return {
          ok: false,
          error: {
            provider: this.name,
            class: classify(res.status, json),
            message: json.message ?? 'Verification service unavailable.',
            raw: json,
          },
        };
      }
      return { ok: true, value: { sid: json.sid ?? 'unknown', status: json.status ?? 'pending' } };
    } catch (e) {
      return {
        ok: false,
        error: { provider: this.name, class: 'network', message: 'Verification service unavailable.', raw: e },
      };
    }
  }
}
