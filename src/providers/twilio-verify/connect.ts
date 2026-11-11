import type { ConfigValidation, ProviderFailure, ProviderHealth } from '@/contracts/providers';
import type { TwilioVerifyCheckInput, TwilioVerifyProvider, TwilioVerifySendInput } from './types';
import { TWILIO_VERIFY_POLICY, codeApproved } from './types';

/**
 * Twilio Verify through Vercel Connect: the Twilio credential lives in the Vercel connector, as the
 * Resend one does (`../auth-email/resend.ts`), and is asked for when a text is sent. Nothing about
 * Twilio is stored in this project's environment.
 *
 * Four things are not known until the connector answers, so each is worked out once and kept:
 *
 * - **What the connector is called.** `TWILIO_CONNECTOR` or `twilio/wedding` first; when Vercel has
 *   no connector of that name, the project's connectors are listed and one for Twilio is used.
 * - **Who the token is for.** A connector set up with one account credential answers for the app;
 *   one authorized by a person answers for that person (the Resend connector is of this kind, and
 *   its user id is tried too).
 * - **How Twilio wants the token presented.** An OAuth access token goes in a Bearer header; an
 *   auth token or API key secret is the password of a Basic header whose user is the account or
 *   key SID, which the connector reports beside the token or in its public settings. The first
 *   form Twilio accepts is kept.
 * - **Which Verify service sends the codes.** `TWILIO_VERIFY_SERVICE_SID` when it is set; otherwise
 *   the account's first Verify service, and when the account has none, one is created.
 */
export const DEFAULT_TWILIO_CONNECTOR = 'twilio/wedding';
const VERIFY = 'https://verify.twilio.com/v2';
/** What a text from a service this code creates says it is from: "Your Sara and Tyler verification code is …". Letters and spaces only: Twilio refused "Sara + Tyler" (60200 Invalid parameter: FriendlyName). */
const SERVICE_NAME = 'Sara and Tyler';

type Subject = { type: 'app' } | { type: 'user'; id: string };
export interface ConnectTokenAnswer {
  token: string;
  tenantId?: string;
  externalSubject?: string;
  metadata?: Record<string, unknown>;
}
export type GetTokenResponse = (connector: string, params: { subject: Subject }) => Promise<ConnectTokenAnswer>;

export interface ConnectTwilioOptions {
  connector?: string;
  /** User ids to try after the app subject (the connector's own, then the Resend connector's). */
  userIds?: (string | undefined)[];
  serviceSid?: string;
  getTokenResponse?: GetTokenResponse;
  /** The connector's public settings (its account SID, when Vercel shows one). Best effort. */
  getMetadata?: (connector: string) => Promise<unknown>;
  /** Other connectors to try when the named one gives no token: this project's Twilio connectors. */
  discover?: () => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

type PostResult = { ok: true; value: { sid: string; status: string } } | { ok: false; error: ProviderFailure };

function classify(status: number): ProviderFailure['class'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'malformed_response';
}

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;

/** Every string in a value, a few levels down: where a connector's settings might hold a SID. */
function strings(value: unknown, depth = 3): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || depth === 0) return [];
  return Object.values(value).flatMap((v) => strings(v, depth - 1));
}

/** Every `Authorization` header the answer could mean, most likely first, without repeats. */
export function authorizationCandidates(answer: ConnectTokenAnswer, settings?: unknown): string[] {
  const token = answer.token.trim();
  const sids = [answer.tenantId, answer.externalSubject, ...strings(answer.metadata), ...strings(settings)]
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => /^(AC|SK)[0-9a-fA-F]{32}$/.test(v));
  const out: string[] = [];
  // `SID:secret` handed over whole.
  if (/^(AC|SK)[0-9a-fA-F]{32}:.+/.test(token)) out.push(`Basic ${Buffer.from(token, 'utf8').toString('base64')}`);
  // A JWT is an OAuth access token; anything else with a known SID is that SID's secret.
  const looksLikeJwt = token.split('.').length === 3;
  if (looksLikeJwt) out.push(`Bearer ${token}`);
  // An API key (SK…) before the account (AC…): a key secret only works with its own key SID.
  for (const sid of [...sids.filter((s) => s.startsWith('SK')), ...sids.filter((s) => s.startsWith('AC'))]) out.push(basic(sid, token));
  if (!looksLikeJwt) out.push(`Bearer ${token}`);
  return [...new Set(out)];
}

export class ConnectTwilioVerify implements TwilioVerifyProvider {
  kind = 'twilio-verify' as const;
  name = 'twilio-verify';
  mode = 'live' as const;
  capabilities = { start: true, check: true };
  policy = TWILIO_VERIFY_POLICY;

  private connector: string;
  private readonly subjects: Subject[];
  private readonly fetchImpl: typeof fetch;
  private readonly getTokenResponse: GetTokenResponse;
  private readonly getMetadata: (connector: string) => Promise<unknown>;
  private readonly discover: () => Promise<string[]>;
  private settings: Promise<unknown> | undefined;
  private subject: Subject | undefined;
  private scheme: number | undefined;
  private service: string | undefined;

  constructor(options: ConnectTwilioOptions = {}) {
    this.connector = options.connector?.trim() || DEFAULT_TWILIO_CONNECTOR;
    const users = [...new Set((options.userIds ?? []).map((id) => id?.trim()).filter((id): id is string => !!id))];
    this.subjects = [{ type: 'app' }, ...users.map((id) => ({ type: 'user' as const, id }))];
    this.service = options.serviceSid?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getTokenResponse =
      options.getTokenResponse ??
      (async (connector, params) => {
        const { getTokenResponse } = await import('@vercel/connect');
        return getTokenResponse(connector, params);
      });
    this.getMetadata =
      options.getMetadata ??
      (async (connector) => {
        const { getConnectorMetadata } = await import('@vercel/connect');
        return getConnectorMetadata(connector);
      });
    this.discover = options.discover ?? (() => projectTwilioConnectors(this.fetchImpl));
  }

  validateConfig(): ConfigValidation {
    return { ok: true, missing: [], warnings: [] };
  }

  /** Can a text be sent right now? Asks the connector, Twilio and the Verify service, in that order. */
  async ready(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.serviceSid();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `${describe(e)} [connector settings: ${await this.connectorSettings()}]` };
    }
  }

  /** The connector's public settings as Vercel reports them, for the log line that says why no text can be sent. */
  private async connectorSettings(): Promise<string> {
    try {
      return summarize(await this.getMetadata(this.connector), 6).slice(0, 2500);
    } catch (e) {
      return `unreadable (${describe(e)})`;
    }
  }

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    const ready = await this.ready();
    return ready.ok
      ? { status: 'up', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started }
      : { status: 'down', checkedAt: new Date().toISOString(), detail: ready.reason };
  }

  async startVerification(input: TwilioVerifySendInput): Promise<PostResult> {
    const body = new URLSearchParams({ To: input.to, Channel: 'sms' });
    if (input.customMessage?.trim()) body.set('CustomFriendlyName', input.customMessage.trim().slice(0, 32));
    return this.post('Verifications', body);
  }

  async checkVerification(input: TwilioVerifyCheckInput): Promise<{ ok: true } | { ok: false; error: ProviderFailure }> {
    const res = await this.post('VerificationCheck', new URLSearchParams({ To: input.to, Code: input.code }));
    if (!res.ok) return res;
    return codeApproved(this.name, res.value.status);
  }

  private async post(path: string, body: URLSearchParams): Promise<PostResult> {
    try {
      const sid = await this.serviceSid();
      const res = await this.call(`${VERIFY}/Services/${encodeURIComponent(sid)}/${path}`, { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
      if (!res.ok) return { ok: false, error: { provider: this.name, class: classify(res.status), message: json.message ?? 'Verification service unavailable.', raw: json } };
      return { ok: true, value: { sid: json.sid ?? 'unknown', status: json.status ?? 'pending' } };
    } catch (e) {
      const cls: ProviderFailure['class'] = e instanceof TwilioUnavailable ? 'auth' : 'network';
      return { ok: false, error: { provider: this.name, class: cls, message: 'Verification service unavailable.', raw: describe(e) } };
    }
  }

  /** The Verify service to send through: configured, found, or created. */
  private async serviceSid(): Promise<string> {
    if (this.service) return this.service;
    const listed = await this.call(`${VERIFY}/Services?PageSize=20`, { method: 'GET' });
    if (!listed.ok) throw new TwilioUnavailable(`Twilio answered ${listed.status} when asked for its Verify services`);
    const { services = [] } = (await listed.json().catch(() => ({}))) as { services?: { sid?: string }[] };
    const found = services.find((s) => typeof s.sid === 'string' && s.sid.startsWith('VA'))?.sid;
    if (found) return (this.service = found);
    const created = await this.call(`${VERIFY}/Services`, { method: 'POST', body: new URLSearchParams({ FriendlyName: SERVICE_NAME, CodeLength: '6' }) });
    const json = (await created.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!created.ok || !json.sid) {
      // Twilio's own error code and message (never a credential), after how many services the list returned.
      throw new TwilioUnavailable(`Twilio answered ${created.status} when asked to create a Verify service (code ${json.code ?? 'none'}: ${json.message ?? 'no message'}; the account listed ${services.length} service(s))`);
    }
    return (this.service = json.sid);
  }

  /** One request to Twilio, with whichever subject and header form it accepts. Both are remembered. */
  private async call(url: string, init: { method: 'GET' | 'POST'; body?: URLSearchParams }): Promise<Response> {
    const answer = await this.token();
    this.settings ??= this.getMetadata(this.connector).catch(() => undefined);
    const candidates = authorizationCandidates(answer, await this.settings);
    const order = this.scheme === undefined ? candidates.map((_, i) => i) : [this.scheme];
    let last: Response | undefined;
    for (const i of order) {
      const authorization = candidates[i];
      if (!authorization) continue;
      last = await this.fetchImpl(url, {
        method: init.method,
        headers: { Authorization: authorization, ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(init.body ? { body: init.body } : {}),
        signal: AbortSignal.timeout(this.policy.timeoutMs),
      });
      if (last.status !== 401) {
        this.scheme = i;
        return last;
      }
    }
    // A header form that used to work and no longer does: start over on the next call.
    this.scheme = undefined;
    if (!last) throw new TwilioUnavailable('the connector returned nothing Twilio could be called with');
    return last;
  }

  private async token(): Promise<ConnectTokenAnswer> {
    const errors: string[] = [];
    const ask = async (connector: string): Promise<ConnectTokenAnswer | undefined> => {
      for (const subject of this.subject ? [this.subject] : this.subjects) {
        try {
          const answer = await this.getTokenResponse(connector, { subject });
          if (answer?.token) {
            this.subject = subject;
            return answer;
          }
          errors.push(`${connector} ${subject.type}: empty token`);
        } catch (e) {
          errors.push(`${connector} ${subject.type}: ${describe(e)}`);
        }
      }
      return undefined;
    };
    const named = await ask(this.connector);
    if (named) return named;
    // Not under that name: any Twilio connector this project has. The one that answers is kept.
    this.subject = undefined;
    const others = await this.discover().catch((e: unknown) => (errors.push(`listing connectors: ${describe(e)}`), [] as string[]));
    for (const connector of others.filter((uid) => uid !== this.connector)) {
      const answer = await ask(connector);
      if (answer) {
        this.connector = connector;
        this.settings = undefined;
        return answer;
      }
    }
    throw new TwilioUnavailable(`connector ${this.connector} gave no token (${errors.join('; ').slice(0, 600)})`);
  }
}

/**
 * The UIDs of this project's connectors for Twilio, asked of Vercel with the deployment's own
 * identity (its OIDC token, which Vercel puts on each request). Empty off Vercel.
 */
async function projectTwilioConnectors(fetchImpl: typeof fetch): Promise<string[]> {
  const context = (globalThis as Record<symbol, { get?: () => { headers?: Record<string, string | undefined> } } | undefined>)[Symbol.for('@vercel/request-context')];
  const oidc = context?.get?.().headers?.['x-vercel-oidc-token'] ?? process.env.VERCEL_OIDC_TOKEN;
  if (!oidc) return [];
  const url = new URL('https://api.vercel.com/v2/connect/connectors');
  url.searchParams.set('limit', '100');
  if (process.env.VERCEL_PROJECT_ID) url.searchParams.set('projectId', process.env.VERCEL_PROJECT_ID);
  const res = await fetchImpl(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${oidc}` }, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw Object.assign(new Error('Vercel would not list connectors'), { status: res.status });
  const body = (await res.json().catch(() => ({}))) as { connectors?: unknown; data?: unknown };
  const list = [body.connectors, body.data, body].find(Array.isArray) as { uid?: unknown; name?: unknown; type?: unknown; service?: unknown }[] | undefined;
  return (list ?? [])
    .filter((c) => [c.uid, c.name, c.type, c.service].some((v) => typeof v === 'string' && /twilio/i.test(v)))
    .map((c) => c.uid)
    .filter((uid): uid is string => typeof uid === 'string');
}

class TwilioUnavailable extends Error {}

/** An error as a log line: its kind, code and message. Never a credential: Connect errors carry none. */
function describe(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown error';
  const code = (e as { code?: unknown }).code;
  const status = (e as { status?: unknown }).status;
  const vendor = (e as { vendor?: unknown }).vendor;
  return [e.name !== 'Error' ? e.name : '', typeof code === 'string' ? code : '', typeof status === 'number' ? String(status) : '', e.message, vendor ? `vendor ${summarize(vendor)}` : '']
    .filter(Boolean)
    .join(' ')
    .slice(0, 500);
}

/**
 * A settings object as one log-safe line: names, and values only where they cannot be a credential
 * (booleans, numbers, URLs, short plain words). Anything else is its length and first two letters.
 */
const PUBLIC_SETTING = /^(https:\/\/[a-z0-9.\-]+\/[a-z0-9.\-/_]*|client_secret_post|client_secret_basic|private_key_jwt|none)$/i;
export function summarize(value: unknown, depth = 3): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value === '') return 'empty';
    if (/^https?:\/\/[^\s?#]+$/.test(value)) return value;
    if (value.length <= 32 && /^[a-z][a-z0-9_.\-/ ]*$/i.test(value) && !/^(AC|SK|OQ|VA)[0-9a-f]{16,}/i.test(value)) return value;
    return `<${value.length} chars, ${value.slice(0, 2)}…>`;
  }
  if (depth === 0) return '…';
  if (Array.isArray(value)) return `[${value.slice(0, 8).map((v) => summarize(v, depth - 1)).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .slice(0, 30)
      .map(([k, v]) => `${k}: ${/secret|token|password|credential|private/i.test(k) && typeof v === 'string' && !PUBLIC_SETTING.test(v) ? (v ? '<set>' : 'empty') : summarize(v, depth - 1)}`)
      .join(', ')}}`;
  }
  return typeof value;
}
