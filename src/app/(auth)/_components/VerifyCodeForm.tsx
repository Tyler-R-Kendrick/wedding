'use client';

import { useEffect, useRef } from 'react';
import { WebOtpInputSync } from './web-otp';
import { Actions, Button, CodeInput, Field } from './kit';

/** OTP verify form with WebOTP and auto-submit at six digits. */
export function VerifyCodeForm({
  error,
  backHref,
  verifyAction,
}: {
  error?: string | null;
  backHref: string;
  verifyAction: (formData: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const input = form.querySelector<HTMLInputElement>('input[name="code"]');
    if (!input) return;
    const maybeSubmit = () => {
      const digits = input.value.replace(/\D/g, '');
      if (digits.length === 6) {
        input.value = digits;
        form.requestSubmit();
      }
    };
    input.addEventListener('input', maybeSubmit);
    return () => input.removeEventListener('input', maybeSubmit);
  }, []);

  return (
    <form ref={formRef} action={verifyAction}>
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
