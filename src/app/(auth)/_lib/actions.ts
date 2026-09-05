'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { RegisterPasskeyResult } from '@/capabilities/register_passkey';
import type { RequestOtpResult } from '@/capabilities/request_otp';
import type { StepUpResult } from '@/capabilities/step_up';
import type { SignInOutcome } from '@/capabilities/identity/signin';
import type { ClaimIdentityResult } from '@/capabilities/claim_identity';
import type { UpdateMyContactResult } from '@/capabilities/update_my_contact';
import { safeReturnPath } from '@/domain/identity/routes';
import { getAuth } from '@/lib/auth';
import { clearChallengeCookie, readChallengeCookie, setChallengeCookie } from './challenge-cookie';
import { errorCode } from './errors';
import { invokeFromRequest } from './invoke';

/**
 * Server actions for the claim / sign-in / step-up journeys. Every action is a thin adapter:
 * parse the form, invoke the capability, redirect with a short error *code* (never text).
 * The challenge rides in an HttpOnly cookie, never in the URL. Works without JavaScript.
 */
const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

const withError = (path: string, code: string) => `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(code)}`;

export async function startClaim(formData: FormData): Promise<void> {
  const token = str(formData, 'token');
  const guestId = str(formData, 'guestId');
  const next = safeReturnPath(str(formData, 'next'), '');
  const back = `/invite/${encodeURIComponent(token)}`;
  if (!guestId) redirect(withError(back, 'pick'));
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: 'claim', token, guestId, next: next || undefined });
  if (!r.ok) redirect(withError(back, errorCode(r.error)));
  if (!r.value.data.sent) redirect(withError(back, 'no_email'));
  const d = r.value.data;
  await setChallengeCookie({ c: d.challenge, to: d.deliveredTo, for: d.deliveredFor ?? undefined, back, kind: 'claim' });
  redirect('/claim/verify');
}

export async function sendSignInCode(formData: FormData): Promise<void> {
  const email = str(formData, 'email');
  const admin = str(formData, 'admin') === '1';
  const next = safeReturnPath(str(formData, 'next'), '');
  const back = admin ? '/sign-in/admin' : '/sign-in';
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: admin ? 'admin_sign_in' : 'sign_in', email, next: next || undefined });
  if (!r.ok) redirect(withError(back, errorCode(r.error)));
  if (!r.value.data.sent) redirect(withError(back, 'no_email'));
  await setChallengeCookie({ c: r.value.data.challenge, to: r.value.data.deliveredTo, back, kind: admin ? 'admin_sign_in' : 'sign_in' });
  redirect('/claim/verify');
}

export async function verifyCode(formData: FormData): Promise<void> {
  const code = str(formData, 'code').replace(/\s+/g, '');
  const cookie = await readChallengeCookie();
  if (!cookie || !['claim', 'sign_in', 'admin_sign_in'].includes(cookie.kind)) redirect(withError('/claim/verify', 'expired'));
  const r = await invokeFromRequest<SignInOutcome>('verify_otp', { challenge: cookie.c, code });
  if (!r.ok) redirect(withError('/claim/verify', errorCode(r.error)));
  await clearChallengeCookie();
  const d = r.value.data;
  if (d.isAdmin && !d.guestId) redirect(safeReturnPath(d.next, '/admin'));
  if (!d.guestId) redirect(withError('/sign-in', 'unlinked'));
  redirect(safeReturnPath(d.next, '/claim/welcome'));
}

export async function requestStepUpCode(formData: FormData): Promise<void> {
  const next = safeReturnPath(str(formData, 'next'), '/claim/welcome');
  const target = `/step-up?next=${encodeURIComponent(next)}`;
  const r = await invokeFromRequest<RequestOtpResult>('request_otp', { purpose: 'step_up', next });
  if (!r.ok) redirect(withError(target, errorCode(r.error)));
  if (!r.value.data.sent) redirect(withError(target, 'no_email'));
  await setChallengeCookie({ c: r.value.data.challenge, to: r.value.data.deliveredTo, kind: 'step_up' });
  redirect(target);
}

export async function stepUpWithCode(formData: FormData): Promise<void> {
  const code = str(formData, 'code').replace(/\s+/g, '');
  const next = safeReturnPath(str(formData, 'next'), '/claim/welcome');
  const target = `/step-up?next=${encodeURIComponent(next)}`;
  const cookie = await readChallengeCookie();
  if (!cookie || cookie.kind !== 'step_up') redirect(withError(target, 'expired'));
  const r = await invokeFromRequest<StepUpResult>('step_up', { method: 'otp', challenge: cookie.c, code });
  if (!r.ok) redirect(withError(target, errorCode(r.error)));
  await clearChallengeCookie();
  redirect(next);
}

export async function claimPerson(formData: FormData): Promise<void> {
  const guestId = str(formData, 'guestId');
  const token = str(formData, 'token');
  const r = await invokeFromRequest<ClaimIdentityResult>('claim_identity', { guestId, token: token || undefined });
  if (!r.ok) {
    if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent('/claim/welcome')}`);
    redirect(withError('/claim/welcome', errorCode(r.error)));
  }
  redirect('/claim/welcome?switched=1');
}

export async function updateEmail(formData: FormData): Promise<void> {
  const code = str(formData, 'code').replace(/\s+/g, '');
  const cookie = await readChallengeCookie();
  if (code && cookie?.kind === 'change_email' && cookie.email) {
    const r = await invokeFromRequest<UpdateMyContactResult>('update_my_contact', { email: cookie.email, challenge: cookie.c, code });
    if (!r.ok) {
      if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent('/claim/welcome?contact=1')}`);
      redirect(withError('/claim/welcome?contact=1', errorCode(r.error)));
    }
    await clearChallengeCookie();
    redirect('/claim/welcome?contact=done');
  }
  const email = str(formData, 'email');
  const r = await invokeFromRequest<UpdateMyContactResult>('update_my_contact', { email });
  if (!r.ok) {
    if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent('/claim/welcome?contact=1')}`);
    redirect(withError('/claim/welcome', errorCode(r.error)));
  }
  const d = r.value.data;
  if (d.status === 'verification_sent') {
    await setChallengeCookie({ c: d.challenge, to: d.deliveredTo, email, kind: 'change_email' });
    redirect('/claim/welcome?contact=1');
  }
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
  await clearChallengeCookie();
  redirect('/');
}
