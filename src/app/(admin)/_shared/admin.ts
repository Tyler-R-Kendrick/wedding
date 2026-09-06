import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCapabilityContext, invoke } from '@/capabilities';
import type { CapabilityDescriptor } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

export async function adminPrincipal(): Promise<{ principal: Principal; requestId: string }> {
  const h = await headers();
  return { principal: await getPrincipal(new Request('http://wedding.local/admin', { headers: h })), requestId: getRequestId(h) };
}

/** Runs a capability for the current request's principal (authorization stays inside the pipeline). */
export async function adminInvoke<I, O>(cap: CapabilityDescriptor<I, O>, input: unknown, extra: { idempotencyKey?: string } = {}) {
  const { principal, requestId } = await adminPrincipal();
  // Same reason as the guest path: admin server actions reach invoke() directly, so the
  // per-principal budget is wired here rather than left to the JSON capability route.
  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui', idempotencyKey: extra.idempotencyKey, rateLimit: true });
  return invoke(cap, ctx, input);
}

const str = (fd: FormData, key: string): string | null => {
  const v = fd.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};
export const field = str;
export const flag = (fd: FormData, key: string) => fd.get(key) === 'on' || fd.get(key) === 'yes' || fd.get(key) === 'true';
export const num = (fd: FormData, key: string, fallback: number) => {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? n : fallback;
};

/** Server actions redirect back to their page with a one-line outcome (no client JS needed). */
export function back(path: string, outcome: { ok?: string; error?: string }): never {
  const q = new URLSearchParams();
  if (outcome.ok) q.set('ok', outcome.ok.slice(0, 200));
  if (outcome.error) q.set('error', outcome.error.slice(0, 300));
  redirect(`${path}?${q.toString()}`);
}

export function describeError(e: { code: string; message: string; details?: Record<string, unknown> }): string {
  const issues = e.details?.issues as Array<{ path: string; message: string }> | undefined;
  return issues?.length ? `${e.message} ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}` : e.message;
}
