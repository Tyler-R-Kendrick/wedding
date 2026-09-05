import { CapabilityError } from '@/contracts/errors';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import { hmacSha256, randomToken, timingSafeEqualString } from '@/lib/crypto';

/**
 * HMAC-signed confirmation tokens. A `draft` capability issues one for a specific
 * (capability, principal, payload hash); the matching `action`/`transaction` with
 * `confirmation: 'explicit'` must present it before the pipeline runs the handler.
 * Tokens are stateless, short-lived, and bound to the exact payload they confirm.
 */
export interface ConfirmationClaims {
  capability: string;
  principalRef: PrincipalRef;
  payloadHash: string;
}

export interface IssuedConfirmation {
  token: string;
  expiresAt: string;
}

interface TokenBody {
  v: 1;
  c: string; // capability
  p: string; // principal key
  h: string; // payload hash
  iat: number;
  exp: number;
  n: string; // nonce
}

export const DEFAULT_CONFIRMATION_TTL_SECONDS = 5 * 60;
export const CONFIRMATION_MESSAGE = 'Please review and confirm before we continue.';

export function principalKey(ref: PrincipalRef): string {
  switch (ref.kind) {
    case 'anonymous':
      return 'anonymous';
    case 'guest':
      return `guest:${ref.guestId}`;
    case 'admin':
      return `admin:${ref.adminId}`;
    case 'system':
      return `system:${ref.component}`;
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

export class ConfirmationService {
  constructor(private readonly secret: string) {
    if (secret.length < 16) throw new Error('confirmation secret must be at least 16 characters');
  }

  issue(claims: ConfirmationClaims, opts: { ttlSeconds?: number; now?: Date } = {}): IssuedConfirmation {
    const now = opts.now ?? new Date();
    const ttl = opts.ttlSeconds ?? DEFAULT_CONFIRMATION_TTL_SECONDS;
    const body: TokenBody = {
      v: 1,
      c: claims.capability,
      p: principalKey(claims.principalRef),
      h: claims.payloadHash,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + ttl,
      n: randomToken(8),
    };
    const encoded = b64(JSON.stringify(body));
    const sig = hmacSha256(this.secret, encoded);
    return { token: `${encoded}.${sig}`, expiresAt: new Date(body.exp * 1000).toISOString() };
  }

  verify(token: string | undefined, expected: ConfirmationClaims, now: Date = new Date()): Result<{ issuedAt: string }, CapabilityError> {
    if (!token) return err(new CapabilityError('confirmation_required', CONFIRMATION_MESSAGE, { reason: 'missing' }));
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return err(this.invalid('malformed'));
    if (!timingSafeEqualString(hmacSha256(this.secret, encoded), sig)) return err(this.invalid('signature'));
    let body: TokenBody;
    try {
      body = JSON.parse(unb64(encoded)) as TokenBody;
    } catch {
      return err(this.invalid('malformed'));
    }
    if (body.v !== 1) return err(this.invalid('version'));
    if (body.c !== expected.capability) return err(this.invalid('capability'));
    if (body.p !== principalKey(expected.principalRef)) return err(this.invalid('principal'));
    if (body.h !== expected.payloadHash) return err(this.invalid('payload'));
    if (Math.floor(now.getTime() / 1000) >= body.exp) {
      return err(new CapabilityError('confirmation_required', 'That confirmation has expired — please review again.', { reason: 'expired' }));
    }
    return ok({ issuedAt: new Date(body.iat * 1000).toISOString() });
  }

  private invalid(reason: string): CapabilityError {
    return new CapabilityError('confirmation_required', CONFIRMATION_MESSAGE, { reason });
  }
}

export const DEV_CONFIRMATION_SECRET = 'dev-only-confirmation-secret-change-me';

let singleton: ConfirmationService | undefined;

/** App-level service: CONFIRMATION_SECRET from the environment, dev default with a warning. */
export async function getConfirmationService(): Promise<ConfirmationService> {
  if (singleton) return singleton;
  const [{ env }, { logger }] = await Promise.all([import('@/lib/env'), import('@/lib/logger')]);
  let secret = env.CONFIRMATION_SECRET;
  if (!secret) {
    if (env.isProduction) throw new Error('CONFIRMATION_SECRET is required in production');
    if (!env.isTest) logger.warn('CONFIRMATION_SECRET is not set; using the development default');
    secret = DEV_CONFIRMATION_SECRET;
  }
  singleton = new ConfirmationService(secret);
  return singleton;
}
