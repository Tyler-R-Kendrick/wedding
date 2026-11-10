import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invoke } from '@/capabilities';
import type { CapabilityDescriptor, CapabilityOutcome } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { err, type Result } from '@/contracts/result';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getPrincipal } from '@/lib/principal';
import { getClientIp, getRequestId } from '@/lib/request';
import { getProvider } from '@/providers';
import type { NoticeCode } from './recipe';

/** Who is rendering / submitting. Server components and server actions both read the request headers. */
export async function currentPrincipal(): Promise<{ principal: Principal; requestId: string }> {
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  return { principal, requestId: getRequestId(h) };
}

/** Every page and action goes through the capability pipeline on the `ui` surface; nothing here authorises anything itself. */
export async function runAsUi<I, O>(cap: CapabilityDescriptor<I, O>, input: unknown, opts: { idempotencyKey?: string; meterAnonymous?: boolean } = {}): Promise<Result<CapabilityOutcome<O>, CapabilityError>> {
  const { principal, requestId } = await currentPrincipal();
  const h = await headers();
  const clientIp = getClientIp(h, env.TRUSTED_PROXY_HOPS);
  // The same budget policy as the JSON route: a signed-in caller is metered inside the pipeline (one
  // bucket for the route and server actions alike); anonymous callers share one principal key, so an
  // action that costs something (a live partner search) meters them by client instead. Without this,
  // a server action was an unmetered door to paid flight and hotel APIs.
  if (principal.kind === 'anonymous' && opts.meterAnonymous) {
    const decision = await getProvider('rate-limit', { db: await getDb() }).consume(`cap:anon:${clientIp}`, 'capability');
    if (!decision.allowed) return err(new CapabilityError('rate_limited', 'You have tried that a few times. Please wait a moment and try again.', { retryAfterMs: decision.retryAfterMs }));
  }
  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui', idempotencyKey: opts.idempotencyKey, inputTrust: 'UNTRUSTED_USER_CONTENT', rateLimit: principal.kind !== 'anonymous', clientIp });
  return invoke(cap, ctx, input);
}

export interface FormIssue {
  path: string;
  message: string;
}
export interface FormError {
  code: string;
  message: string;
  issues: FormIssue[];
}

export function toFormError(error: CapabilityError): FormError {
  const raw = error.details?.issues;
  const issues = Array.isArray(raw) ? (raw as FormIssue[]).filter((i) => typeof i?.path === 'string' && typeof i?.message === 'string') : [];
  return { code: error.code, message: error.message, issues };
}

export function noticeForError(error: CapabilityError): NoticeCode {
  switch (error.code) {
    case 'not_found':
      return 'not_found';
    case 'forbidden':
    case 'unauthenticated':
      return 'forbidden';
    case 'validation':
    case 'conflict':
      return 'invalid';
    default:
      return 'error';
  }
}

/** FormData readers. Empty strings mean "not provided" so zod defaults apply. */
export const field = {
  str(fd: FormData, name: string): string | undefined {
    const v = fd.get(name);
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length ? t : undefined;
  },
  int(fd: FormData, name: string): number | undefined {
    const s = field.str(fd, name);
    if (s === undefined) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  },
  bool(fd: FormData, name: string): boolean {
    const v = fd.get(name);
    return v === 'on' || v === 'true' || v === '1';
  },
  list(fd: FormData, name: string): string[] {
    return (field.str(fd, name) ?? '').split(/[,\s]+/).filter(Boolean);
  },
  values(fd: FormData, names: readonly string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = fd.get(n);
      if (typeof v === 'string') out[n] = v;
    }
    return out;
  },
  /** The client regenerates the key per submit; without JavaScript one is minted here (that submit is then not replay-safe). */
  idempotencyKey(fd: FormData): string {
    // Forms name the field `idempotencyKey`. (The admin console's `idem` field went with its forms:
    // its screens are admin-kit flows that send the key in the capability request.)
    const k = field.str(fd, 'idempotencyKey');
    return k && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(k) ? k : newId();
  },
};
