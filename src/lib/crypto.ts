import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 as base64url. */
export function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Constant-time string comparison (length differences still short-circuit safely). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Compare against self to keep timing flat, then fail.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Random URL-safe token. Default 32 bytes ≈ 43 chars. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric one-time code (e.g. OTP). Uses rejection sampling to avoid modulo bias. */
export function randomNumericCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < limit) return String(n % max).padStart(digits, '0');
  }
}

/** Canonical JSON: sorted keys, no whitespace, undefined dropped. Stable across processes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Stable content hash of any JSON-serializable value. */
export function stableHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
