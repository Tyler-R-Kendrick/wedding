'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { adminCancelJob, adminDisableFlagReadiness, adminPublishLifecycle, adminRetryJob, draftLifecycleTransition } from '@/capabilities/ops';
import { navigateTo } from '@/capabilities/navigate_to';
import { newId } from '@/contracts/ids';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { READINESS_GATED, type FeatureFlag } from '@/contracts/flags';
import { PREVIEW_COOKIE, PREVIEW_TTL_SECONDS } from '@/domain/lifecycle/constants';
import { adminInvoke } from '../../_shared/admin';

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

function back(page: string, outcome: { ok?: string; error?: string }): never {
  const q = new URLSearchParams();
  if (outcome.ok) q.set('ok', outcome.ok.slice(0, 240));
  if (outcome.error) q.set('error', outcome.error.slice(0, 300));
  redirect(`${page}?${q.toString()}`);
}

const isLifecycleState = (v: string): v is LifecycleState => (LIFECYCLE_STATES as readonly string[]).includes(v);
const isGatedFlag = (v: string): v is FeatureFlag => (READINESS_GATED as readonly string[]).includes(v);

export interface PublishProposal {
  ok: boolean;
  error?: string;
  from?: LifecycleState;
  to?: LifecycleState;
  note?: string;
  direction?: 'forward' | 'back';
  navGained?: string[];
  navLost?: string[];
  consequences?: string[];
  token?: string;
  expiresAt?: string;
  /** Render-time idempotency key, so a double-submitted publish replays instead of burning the token. */
  idem?: string;
}

/**
 * Step one of publishing: no side effects, and the confirmation token comes back for the admin to
 * present with their own second submit. The token is bound to this exact state and note, is
 * single-use, and is only redeemable from the website — so a draft that is read by anything other
 * than a person on this page cannot be completed by it.
 */
export async function proposeLifecycle(_prev: PublishProposal, fd: FormData): Promise<PublishProposal> {
  const to = str(fd, 'to');
  if (!isLifecycleState(to)) return { ok: false, error: 'Pick a lifecycle state.' };
  const note = str(fd, 'note');
  const input = { to, note };
  const r = await adminInvoke(draftLifecycleTransition, input);
  if (!r.ok) return { ok: false, error: r.error.message };
  const d = r.value.data;
  return {
    ok: true,
    from: d.from,
    to: d.publish.to,
    note,
    direction: d.direction,
    navGained: d.navGained,
    navLost: d.navLost,
    consequences: d.consequences,
    token: r.value.confirmation?.token,
    expiresAt: r.value.confirmation?.expiresAt,
    idem: newId(),
  };
}

/** Step two: the same input the draft hashed, plus the token the draft issued. */
export async function publishLifecycle(_prev: PublishProposal, fd: FormData): Promise<PublishProposal> {
  const to = str(fd, 'to');
  if (!isLifecycleState(to)) return { ok: false, error: 'Pick a lifecycle state.' };
  const r = await adminInvoke(adminPublishLifecycle, { to, note: str(fd, 'note') }, { idempotencyKey: str(fd, 'idem') || newId(), confirmationToken: str(fd, 'token') });
  if (!r.ok) return { ok: false, error: r.error.message };
  back('/admin/lifecycle', { ok: `Published ${r.value.data.from} → ${r.value.data.state}.` });
}

/**
 * Starts a preview session for this browser. `navigate_to` mints the signed token (admins only, and
 * it audits `lifecycle.previewed`); the cookie only carries it. Nothing about the cookie grants the
 * preview: `resolveLifecycle` re-checks that the reader is an admin on every render, so the same
 * cookie or link in a guest's browser shows the published state.
 */
export async function startPreview(fd: FormData): Promise<void> {
  const state = str(fd, 'state');
  if (!isLifecycleState(state)) back('/admin/lifecycle', { error: 'Pick a lifecycle state to preview.' });
  const r = await adminInvoke(navigateTo, { route: '/', lifecycle: state });
  if (!r.ok) back('/admin/lifecycle', { error: r.error.message });
  const token = r.value.data.preview?.token;
  if (!token) back('/admin/lifecycle', { error: 'No preview token was issued.' });
  const jar = await cookies();
  jar.set({ name: PREVIEW_COOKIE, value: token, httpOnly: true, sameSite: 'lax', path: '/', maxAge: PREVIEW_TTL_SECONDS, secure: process.env.NODE_ENV === 'production' });
  back('/admin/lifecycle', { ok: `Previewing ${state} in this browser. Open the site, then stop the preview when you are done.` });
}

export async function stopPreview(): Promise<void> {
  const jar = await cookies();
  jar.delete(PREVIEW_COOKIE);
  back('/admin/lifecycle', { ok: 'Preview stopped.' });
}

export async function retryJob(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminRetryJob, { jobId: str(fd, 'jobId') }, { idempotencyKey: str(fd, 'idem') || newId() });
  if (!r.ok) back('/admin/jobs', { error: r.error.message });
  back('/admin/jobs', { ok: `Job ${r.value.data.type} is queued to run again (attempt ${r.value.data.attempts + 1}).` });
}

export async function cancelJob(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminCancelJob, { jobId: str(fd, 'jobId') }, { idempotencyKey: str(fd, 'idem') || newId() });
  if (!r.ok) back('/admin/jobs', { error: r.error.message });
  back('/admin/jobs', { ok: `Job ${r.value.data.type} cancelled; it will not run.` });
}

export async function disableFlagReadiness(fd: FormData): Promise<void> {
  const flag = str(fd, 'flag');
  if (!isGatedFlag(flag)) back('/admin/flags', { error: 'That flag has no readiness switch.' });
  const r = await adminInvoke(adminDisableFlagReadiness, { flag }, { idempotencyKey: str(fd, 'idem') || newId() });
  if (!r.ok) back('/admin/flags', { error: r.error.message });
  back('/admin/flags', { ok: r.value.data.changed ? `${flag} readiness switched off.` : `${flag} readiness was already off.` });
}
