'use server';

import { redirect } from 'next/navigation';
import type { SignInOutcome } from '@/capabilities/identity/signin';
import { safeReturnPath } from '@/domain/identity/routes';
import { clearChallengeCookie, rememberVerified } from '../../../_lib/challenge-cookie';
import { errorCode } from '../../../_lib/errors';
import { invokeFromRequest } from '../../../_lib/invoke';

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};

export async function verifyGuestPass(formData: FormData): Promise<void> {
  const slug = str(formData, 'slug');
  const code = str(formData, 'code').replace(/\s+/g, '');
  const next = safeReturnPath(str(formData, 'next'), '');
  const back = `/s/${encodeURIComponent(slug)}`;
  if (!slug || !/^\d{6}$/.test(code)) redirect(`${back}?error=invalid`);
  const r = await invokeFromRequest<SignInOutcome>('verify_guest_sign_in_pass', { slug, code });
  if (!r.ok) redirect(`${back}?error=${encodeURIComponent(errorCode(r.error))}`);
  const d = r.value.data;
  if (!d.guestId && !d.isAdmin) redirect(`${back}?error=unlinked`);
  const fallback =
    d.isAdmin && !d.guestId ? '/admin' : d.needsClaimWelcome ? '/claim/welcome' : d.guestId ? '/guests' : '/claim/welcome';
  const target = safeReturnPath(next || d.next, fallback);
  await clearChallengeCookie();
  await rememberVerified(target);
  redirect(target);
}
