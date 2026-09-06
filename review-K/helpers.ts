/** Shared plumbing for the review-K proof-of-concept tests. Read-only against the swarm's source. */
import { POST as INVOKE } from '@/app/api/webmcp/invoke/[name]/route';
import { GET as MANIFEST } from '@/app/api/webmcp/manifest/route';
import { POST as CAPABILITY } from '@/app/api/capabilities/[name]/route';

export const TEST_AUTH_SECRET = 'review-k-test-auth-secret-0123456789';
export const CONFIRMATION_SECRET = 'review-k-confirmation-secret-0123456789';

/** What a browser sends for a same-origin `fetch`; the bridge demands it from every caller. */
export const SAME_ORIGIN = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } as const;

export const as = (kind: 'guest' | 'guest-fresh' | 'admin' | string) => ({
  'x-test-principal': kind,
  'x-test-auth': TEST_AUTH_SECRET,
});

let n = 0;
/** A distinct client IP per call so the shared anonymous limiter bucket never colours a result. */
export const freshIp = () => ({ 'x-forwarded-for': `10.${(n = (n + 1) % 60000) >> 8}.${n & 0xff}.7` });

export const invoke = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  INVOKE(
    new Request(`http://localhost:3000/api/webmcp/invoke/${name}`, {
      method: 'POST',
      headers: { ...SAME_ORIGIN, ...freshIp(), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );

export const manifest = (headers: Record<string, string> = {}) =>
  MANIFEST(new Request('http://localhost:3000/api/webmcp/manifest', { headers: { ...freshIp(), ...headers } }));

/** The ordinary UI door, for comparing the two surfaces. */
export const uiInvoke = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  CAPABILITY(
    new Request(`http://localhost:3000/api/capabilities/${name}`, {
      method: 'POST',
      headers: { ...SAME_ORIGIN, ...freshIp(), ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ name }) },
  );

// `Record<string, never>` made every property `never`, so the casts the PoCs do on `body.data` /
// `body.error` did not typecheck under `tsc --noEmit`. Plain `Record<string, unknown>` is the same
// thing at runtime and lets the assertions stand unchanged.
export async function jsonOf(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export const key = () => `01JREVIEWK${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
