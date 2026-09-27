'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { navigateTo } from '@/capabilities/navigate_to';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import { PREVIEW_COOKIE, PREVIEW_TTL_SECONDS } from '@/domain/lifecycle/constants';
import { adminInvoke } from '../../_shared/admin';

/*
 * What is left here is what cannot go through /api/capabilities: a preview lives in an httpOnly
 * cookie, and the capability route never sets cookies. Publishing a lifecycle state, retrying and
 * cancelling jobs and switching a readiness gate off are flows and quick actions from the admin kit
 * (`components/admin/flow`) that call their capabilities directly; the server actions that used to
 * do it (proposeLifecycle, publishLifecycle, retryJob, cancelJob, disableFlagReadiness) are gone.
 */

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
