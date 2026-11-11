import { createSign } from 'node:crypto';
import { DEFAULT_CALL_POLICY, type ConfigValidation, type ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import { parseGuestSheet } from './parse';
import type { GuestSheetProvider, GuestSheetSnapshot } from './types';

export interface GoogleSheetsConfig {
  sheetId: string;
  /** A1 range or tab name, e.g. `Guests`. */
  range: string;
  clientEmail: string;
  /** PEM. Literal `\n` sequences (how Vercel's env editor often stores it) are turned back into newlines. */
  privateKey: string;
  cacheSeconds: number;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const NAME = 'google-sheets';

/** How long a failed read keeps the site from asking Google again, unless Google names a longer wait. */
const BACKOFF_MS = 30_000;

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/**
 * Reads the planning sheet with a Google service account: the sheet is shared (Viewer) with the
 * account's email, and the site signs a short JWT with the account's key to get a read-only token.
 * No package: the JWT is signed with node:crypto (RS256), the API is two HTTPS calls.
 *
 * The read is server-side only and cached in-process for `cacheSeconds`, so an edit in the sheet
 * shows in the console within that window without every page view calling Google. When a fresh
 * read fails, the last good read is served marked `stale` rather than an empty list.
 */
export class GoogleSheetsGuestSheet implements GuestSheetProvider {
  readonly kind = 'guest-sheet' as const;
  readonly name = NAME;
  readonly mode = 'live' as const;
  readonly capabilities = { read: true };
  readonly sheetUrl: string;
  private token: { value: string; expiresAt: number } | null = null;
  private last: { at: number; snapshot: GuestSheetSnapshot } | null = null;
  private inflight: Promise<Result<GuestSheetSnapshot, ProviderFailure>> | null = null;
  /** After a failed read, Google is left alone until then (its Retry-After, or BACKOFF_MS). */
  private failed: { until: number; error: ProviderFailure } | null = null;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly config: GoogleSheetsConfig,
    deps: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    this.fetch = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.sheetId)}/edit`;
  }

  validateConfig(): ConfigValidation {
    return okConfig();
  }

  async health() {
    return upHealth('reads on demand; cached ' + this.config.cacheSeconds + 's');
  }

  async read(opts: { fresh?: boolean } = {}): Promise<Result<GuestSheetSnapshot, ProviderFailure>> {
    const age = this.last ? this.now() - this.last.at : Infinity;
    if (!opts.fresh && this.last && age < this.config.cacheSeconds * 1000) return ok(this.last.snapshot);
    // Just after a failure (Google down, or limiting reads) every page view would wait on Google
    // again and fail again: serve what there is until the wait is over. A deliberate refresh asks.
    const stale = () => (this.last ? ok({ ...this.last.snapshot, data: { ...this.last.snapshot.data, stale: true } }) : null);
    if (!opts.fresh && this.failed && this.now() < this.failed.until) return stale() ?? err(this.failed.error);
    // One request at a time: a burst of page views shares the read instead of each calling Google.
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    const result = await this.inflight;
    if (result.ok) {
      this.failed = null;
      return result;
    }
    this.failed = { until: this.now() + Math.max(result.error.retryAfterMs ?? 0, BACKOFF_MS), error: result.error };
    return stale() ?? result;
  }

  private async load(): Promise<Result<GuestSheetSnapshot, ProviderFailure>> {
    const token = await this.accessToken();
    if (!token.ok) return token;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.sheetId)}/values/${encodeURIComponent(this.config.range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const res = await this.call(url, { headers: { authorization: `Bearer ${token.value}` } });
    if (!res.ok) {
      // A token Google refused (revoked, or the key rotated) is not tried again on the next read.
      if (res.error.class === 'auth') this.token = null;
      return res;
    }
    const body = res.value as { values?: unknown };
    if (body.values !== undefined && !Array.isArray(body.values)) return err(failure(NAME, 'malformed_response', 'The guest sheet answered in an unexpected shape.'));
    const parsed = parseGuestSheet((body.values as unknown[][] | undefined) ?? []);
    const snapshot: GuestSheetSnapshot = {
      provider: NAME,
      retrievedAt: new Date(this.now()).toISOString(),
      ttlSeconds: this.config.cacheSeconds,
      data: { ...parsed, stale: false, sample: false },
    };
    this.last = { at: this.now(), snapshot };
    return ok(snapshot);
  }

  private async accessToken(): Promise<Result<string, ProviderFailure>> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return ok(this.token.value);
    const iat = Math.floor(this.now() / 1000);
    const claims = { iss: this.config.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    let signature: string;
    try {
      signature = createSign('RSA-SHA256').update(unsigned).sign(this.config.privateKey.replace(/\\n/g, '\n'), 'base64url');
    } catch (e) {
      return err(failure(NAME, 'auth', 'The guest sheet key could not be used. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.', { raw: e instanceof Error ? e.message : String(e) }));
    }
    const res = await this.call(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    });
    if (!res.ok) return res;
    const body = res.value as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string') return err(failure(NAME, 'malformed_response', 'Google did not return an access token for the guest sheet.'));
    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.token = { value: body.access_token, expiresAt: this.now() + ttl * 1000 };
    return ok(body.access_token);
  }

  private async call(url: string, init: RequestInit): Promise<Result<unknown, ProviderFailure>> {
    let res: Response;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(DEFAULT_CALL_POLICY.timeoutMs), cache: 'no-store' });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return err(failure(NAME, timedOut ? 'timeout' : 'network', timedOut ? 'The guest sheet took too long to answer.' : 'The guest sheet could not be reached.', { raw: e instanceof Error ? e.message : String(e) }));
    }
    if (res.ok) {
      try {
        return ok(await res.json());
      } catch {
        return err(failure(NAME, 'malformed_response', 'The guest sheet answered with something that is not JSON.'));
      }
    }
    const raw = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) return err(failure(NAME, 'auth', 'The site is not allowed to read the guest sheet. Check that the sheet is shared with the service account and the key is current.', { raw }));
    if (res.status === 404) return err(failure(NAME, 'not_found', 'The guest sheet or its tab was not found. Check GUEST_SHEET_ID and GUEST_SHEET_RANGE.', { raw }));
    if (res.status === 429) return err(failure(NAME, 'rate_limited', 'Google is limiting reads of the guest sheet; try again in a minute.', { retryAfterMs: 60_000, raw }));
    if (res.status === 400) return err(failure(NAME, 'bad_request', 'Google refused the guest sheet request. Check GUEST_SHEET_RANGE.', { raw }));
    return err(failure(NAME, 'server', 'Google had a problem reading the guest sheet.', { raw }));
  }
}
