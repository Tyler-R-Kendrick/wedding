import { redirect } from 'next/navigation';
import { GUEST_SAVE_THE_DATE_PATH } from '@/domain/identity/guest-sign-in-paths';

/** Legacy route: unified warm save-the-date guidance. */
export default function SignInPendingPage() {
  redirect(GUEST_SAVE_THE_DATE_PATH);
}
