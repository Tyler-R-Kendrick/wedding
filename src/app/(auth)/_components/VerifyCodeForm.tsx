'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CodeCells } from './CodeCells';
import { WebOtpInputSync } from './web-otp';
import { Actions, Field } from './kit';

/**
 * The code form: six digit boxes, the code a text message offers filled in for you (WebOTP), and no
 * button to press. On the sixth digit the page says at once that it is checking: the boxes hold
 * still, the button reads "Checking…" and cannot be pressed again, and a status line tells
 * a screen reader the same. The guest never sits looking at a finished code wondering whether to
 * press Continue. A code that does not work comes back with the boxes empty and ready to retype.
 */
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
  // Set in the same event as the sixth digit (or the button), before the request has gone out.
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <form ref={formRef} action={verifyAction} onSubmit={() => setSending(true)} aria-busy={sending || undefined}>
      <WebOtpInputSync inputId="code" />
      <Checking
        sending={sending}
        onSettled={() => {
          setSending(false);
          setAttempt((n) => n + 1);
        }}
      >
        {(busy) => (
          <>
            <Field id="code" label="Six-digit code" hint="The numbers from your text or email." error={busy ? null : error}>
              <CodeCells
                error={busy ? null : error}
                busy={busy}
                resetKey={attempt || undefined}
                onComplete={() => {
                  if (busy) return;
                  setSending(true);
                  formRef.current?.requestSubmit();
                }}
              />
            </Field>
            {/* Said to a screen reader; the button says it on screen. */}
            <p className="sr-only" role="status" aria-live="polite">
              {busy ? 'Checking your code…' : ''}
            </p>
            <Actions>
              <button type="submit" className={`auth-button auth-button-primary${busy ? ' is-busy' : ''}`} disabled={busy} aria-disabled={busy || undefined}>
                {busy ? (
                  <>
                    <span className="auth-spinner" aria-hidden="true" />
                    Checking…
                  </>
                ) : (
                  'Continue'
                )}
              </button>
              <a className="auth-link" href={backHref}>
                Send a new code
              </a>
            </Actions>
          </>
        )}
      </Checking>
    </form>
  );
}

/**
 * The form's own pending state (useFormStatus) joined to the moment the code was finished: busy from
 * the sixth digit until the server has answered. When it answers with this page again (a code that
 * did not work), `onSettled` empties the boxes for another try; a code that worked goes on to the
 * next page instead, and this one is gone.
 */
function Checking({ sending, onSettled, children }: { sending: boolean; onSettled: () => void; children: (busy: boolean) => React.ReactNode }) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !pending) onSettled();
    was.current = pending;
  }, [pending, onSettled]);
  return <>{children(sending || pending)}</>;
}
