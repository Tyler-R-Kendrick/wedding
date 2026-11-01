'use client';

import { WebOtpInputSync } from './web-otp';
import { Actions, Button, CodeInput, Field } from './kit';

/** OTP verify form with WebOTP hook ready for future SMS. */
export function VerifyCodeForm({
  error,
  backHref,
  verifyAction,
}: {
  error?: string | null;
  backHref: string;
  verifyAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={verifyAction}>
      <WebOtpInputSync inputId="code" />
      <Field id="code" label="Six-digit code" hint="Digits only, no spaces." error={error}>
        <CodeInput error={error} />
      </Field>
      <Actions>
        <Button>Continue</Button>
        <a className="auth-link" href={backHref}>
          Send a new code
        </a>
      </Actions>
    </form>
  );
}
