import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invoke } from '@/capabilities';
import type { CapabilityDescriptor, CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';
import type { NoticeCode } from './recipe';

/** Who is rendering / submitting. Server components and server actions both read the request headers. */
export async function currentPrincipal(): Promise<{ principal: Principal; requestId: string }> {
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  return { principal, requestId: getRequestId(h) };
}

/** Every page and action goes through the capability pipeline on the `ui` surface; nothing here authorises anything itself. */
export async function runAsUi<I, O>(cap: CapabilityDescriptor<I, O>, input: unknown, opts: { idempotencyKey?: string } = {}): Promise<Result<CapabilityOutcome<O>, CapabilityError>> {
  const { principal, requestId } = await currentPrincipal();
  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui', idempotencyKey: opts.idempotencyKey, inputTrust: 'UNTRUSTED_USER_CONTENT' });
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
    const k = field.str(fd, 'idempotencyKey');
    return k && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(k) ? k : newId();
  },
};
