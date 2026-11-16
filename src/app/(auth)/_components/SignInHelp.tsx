import { GUEST_CONTACT_EMAIL, guestContactMailtoHref } from '@/domain/contact/copy';

/**
 * The way out when a guest's save-the-date email or number doesn't sign them in: write to the
 * couple with the one they'd like to use. Inline text, so each page sets its own opening question.
 */
export function SignInHelp({ lead }: { lead: string }) {
  return (
    <>
      {lead} Email{' '}
      <a className="auth-link" href={guestContactMailtoHref()}>
        {GUEST_CONTACT_EMAIL}
      </a>{' '}
      and tell us the email address or mobile number you’d like to sign in with. We’ll get you set up.
    </>
  );
}
