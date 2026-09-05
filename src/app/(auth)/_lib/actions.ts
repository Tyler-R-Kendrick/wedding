'use server';

import { redirect } from 'next/navigation';
import { isInternalRoute } from '@/capabilities/routes';
import type { RegisterPasskeyResult } from '@/capabilities/register_passkey';
import type { RequestOtpResult } from '@/capabilities/request_otp';
import type { StepUpResult } from '@/capabilities/step_up';
import type { SignInOutcome } from '@/capabilities/identity/signin';
import type { ClaimIdentityResult } from '@/capabilities/claim_identity';
import type { UpdateMyContactResult } from '@/capabilities/update_my_contact';
import { getAuth } from '@/lib/auth';
import { headers } from 'next/headers';
import { invokeFromRequest } from './invoke';

/**
 * Server actions for the claim / sign-in / step-up journeys. Every action is a thin adapter:
 * parse the form, invoke the capability, redirect with a short, non-sensitive status code.
 * Progressive enhancement: each works with plain HTML forms and no JavaScript.
 */
const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

const safeNext = (value: string, fallback: string): string => (value && isInternalRoute(value) ? value : fallback);

const errorParam = (code: string, message?: string) => `error=${encodeURIComponent(code)}${message ? `&m=${encodeURIComponent(message.slice(0, 200))}` : ''}`;

export async function startClaim(formData: FormData): Promise<void> {
  const token = str(formData, 'token');
  const guestId = str(formData, 'guestId');
  const next = str(formData, 'next');
  if (!guestId) redirect(`/invite/${encodeURIComponent(token)}?${errorParam('pick')}`);
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: 'claim', token, guestId, next: next || undefined });
  if (!r.ok) redirect(`/invite/${encodeURIComponent(token)}?${errorParam(r.error.code, r.error.message)}`);
  if (!r.value.data.sent) redirect(`/invite/${encodeURIComponent(token)}?${errorParam('no_email', r.value.data.recovery.message)}`);
  const d = r.value.data;
  redirect(`/claim/verify?c=${encodeURIComponent(d.challenge)}&to=${encodeURIComponent(d.deliveredTo)}${d.deliveredFor ? `&for=${encodeURIComponent(d.deliveredFor)}` : ''}&back=${encodeURIComponent(`/invite/${token}`)}`);
}

export async function sendSignInCode(formData: FormData): Promise<void> {
  const email = str(formData, 'email');
  const admin = str(formData, 'admin') === '1';
  const next = str(formData, 'next');
  const back = admin ? '/sign-in/admin' : '/sign-in';
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: admin ? 'admin_sign_in' : 'sign_in', email, next: next || undefined });
  if (!r.ok) redirect(`${back}?${errorParam(r.error.code, r.error.message)}`);
  if (!r.value.data.sent) redirect(`${back}?${errorParam('no_email', r.value.data.recovery.message)}`);
  redirect(`/claim/verify?c=${encodeURIComponent(r.value.data.challenge)}&to=${encodeURIComponent(r.value.data.deliveredTo)}&back=${encodeURIComponent(back)}`);
}

export async function verifyCode(formData: FormData): Promise<void> {
  const challenge = str(formData, 'challenge');
  const code = str(formData, 'code').replace(/\s+/g, '');
  const to = str(formData, 'to');
  const back = safeNext(str(formData, 'back'), '/sign-in');
  const retry = `/claim/verify?c=${encodeURIComponent(challenge)}&to=${encodeURIComponent(to)}&back=${encodeURIComponent(back)}`;
  const r = await invokeFromRequest<SignInOutcome>('verify_otp', { challenge, code });
  if (!r.ok) redirect(`${retry}&${errorParam(r.error.code, r.error.message)}`);
  const d = r.value.data;
  if (d.isAdmin && !d.guestId) redirect(safeNext(d.next ?? '', '/admin'));
  if (!d.guestId) redirect(`/sign-in?${errorParam('unlinked')}`);
  redirect(safeNext(d.next ?? '', '/claim/welcome'));
}

export async function stepUpWithCode(formData: FormData): Promise<void> {
  const challenge = str(formData, 'challenge');
  const code = str(formData, 'code').replace(/\s+/g, '');
  const next = safeNext(str(formData, 'next'), '/claim/welcome');
  const to = str(formData, 'to');
  const retry = `/step-up?c=${encodeURIComponent(challenge)}&to=${encodeURIComponent(to)}&next=${encodeURIComponent(next)}`;
  const r = await invokeFromRequest<StepUpResult>('step_up', { method: 'otp', challenge, code });
  if (!r.ok) redirect(`${retry}&${errorParam(r.error.code, r.error.message)}`);
  redirect(next);
}

export async function requestStepUpCode(formData: FormData): Promise<void> {
  const next = safeNext(str(formData, 'next'), '/claim/welcome');
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: 'step_up', next });
  if (!r.ok) redirect(`/step-up?next=${encodeURIComponent(next)}&${errorParam(r.error.code, r.error.message)}`);
  if (!r.value.data.sent) redirect(`/step-up?next=${encodeURIComponent(next)}&${errorParam('no_email')}`);
  redirect(`/step-up?c=${encodeURIComponent(r.value.data.challenge)}&to=${encodeURIComponent(r.value.data.deliveredTo)}&next=${encodeURIComponent(next)}`);
}

export async function claimPerson(formData: FormData): Promise<void> {
  const guestId = str(formData, 'guestId');
  const token = str(formData, 'token');
  const r = await invokeFromRequest<ClaimIdentityResult>('claim_identity', { guestId, token: token || undefined });
  if (!r.ok) {
    if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent('/claim/welcome')}`);
    redirect(`/claim/welcome?${errorParam(r.error.code, r.error.message)}`);
  }
  redirect('/claim/welcome?switched=1');
}

export async function updateEmail(formData: FormData): Promise<void> {
  const email = str(formData, 'email');
  const challenge = str(formData, 'challenge');
  const code = str(formData, 'code').replace(/\s+/g, '');
  const r = await invokeFromRequest<UpdateMyContactResult>('update_my_contact', challenge && code ? { email, challenge, code } : { email });
  if (!r.ok) {
    if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent('/claim/welcome?contact=1')}`);
    redirect(`/claim/welcome?contact=1${challenge ? `&c=${encodeURIComponent(challenge)}&email=${encodeURIComponent(email)}` : ''}&${errorParam(r.error.code, r.error.message)}`);
  }
  const d = r.value.data;
  if (d.status === 'verification_sent') redirect(`/claim/welcome?contact=1&c=${encodeURIComponent(d.challenge)}&email=${encodeURIComponent(email)}&to=${encodeURIComponent(d.deliveredTo)}`);
  redirect('/claim/welcome?contact=done');
}

/** Passkey ceremony halves, called from the client component (no forms: WebAuthn needs JS). */
export async function passkeyRegistrationOptions(): Promise<{ ok: true; options: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const r = await invokeFromRequest<RegisterPasskeyResult>('register_passkey', { step: 'options', authenticatorAttachment: undefined });
  if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
  return r.value.data.status === 'options' ? { ok: true, options: r.value.data.options } : { ok: false, code: 'internal', message: 'Unexpected response.' };
}

export async function passkeyRegistrationVerify(response: Record<string, unknown>, name?: string): Promise<{ ok: true; name: string | null } | { ok: false; code: string; message: string }> {
  const r = await invokeFromRequest<RegisterPasskeyResult>('register_passkey', { step: 'verify', response, name });
  if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
  return r.value.data.status === 'registered' ? { ok: true, name: r.value.data.passkey.name } : { ok: false, code: 'internal', message: 'Unexpected response.' };
}

export async function passkeyStepUpOptions(): Promise<{ ok: true; options: Record<string, unknown> } | { ok: false; code: string; message: string }> {
  const r = await invokeFromRequest<StepUpResult>('step_up', { method: 'passkey', step: 'options' });
  if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
  return r.value.data.status === 'options' ? { ok: true, options: r.value.data.options } : { ok: false, code: 'internal', message: 'Unexpected response.' };
}

export async function passkeyStepUpVerify(response: Record<string, unknown>): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const r = await invokeFromRequest<StepUpResult>('step_up', { method: 'passkey', step: 'verify', response });
  if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const auth = await getAuth();
  const h = await headers();
  try {
    await auth.api.signOut({ headers: h });
  } catch {
    // No session: nothing to end.
  }
  redirect('/');
}
