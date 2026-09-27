'use client';

import { useState, useSyncExternalStore } from 'react';
import { passkeyRegistrationOptions, passkeyRegistrationVerify } from '../../_lib/actions';

type Status = 'idle' | 'working' | 'done' | 'error' | 'step_up';

const noop = () => () => {};
const hasCreationJson = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && typeof (window.PublicKeyCredential as unknown as { parseCreationOptionsFromJSON?: unknown }).parseCreationOptionsFromJSON === 'function';

/**
 * Optional passkey enrollment (ADR-0001 rule 3). Uses the WebAuthn JSON helpers built into
 * modern browsers; when they are missing the offer is hidden rather than broken. The server
 * issues and verifies the ceremony through register_passkey; nothing is stored client-side.
 */
export function PasskeyEnroll() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('');
  // Feature detection as an external store: false on the server, real value after hydration, no effect-driven setState.
  const supported = useSyncExternalStore(noop, hasCreationJson, () => false);

  async function enroll() {
    setStatus('working');
    setMessage('');
    try {
      const opts = await passkeyRegistrationOptions();
      if (!opts.ok) {
        setStatus(opts.code === 'step_up_required' ? 'step_up' : 'error');
        setMessage(opts.message);
        return;
      }
      const PKC = window.PublicKeyCredential as unknown as { parseCreationOptionsFromJSON: (json: unknown) => PublicKeyCredentialCreationOptions };
      const publicKey = PKC.parseCreationOptionsFromJSON(opts.options);
      const credential = (await navigator.credentials.create({ publicKey })) as (PublicKeyCredential & { toJSON(): Record<string, unknown> }) | null;
      if (!credential) {
        setStatus('error');
        setMessage('No passkey was created.');
        return;
      }
      const verified = await passkeyRegistrationVerify(credential.toJSON() as unknown as Record<string, unknown>, 'This device');
      if (!verified.ok) {
        setStatus('error');
        setMessage(verified.message);
        return;
      }
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error && e.name === 'NotAllowedError' ? 'That was cancelled — no problem, you can keep using codes.' : 'We couldn’t set up a passkey on this device. You can keep using codes.');
    }
  }

  // Hidden rather than broken — but not silent: the page is about passkeys, and a heading with nothing under it reads as a fault.
  if (!supported) {
    return (
      <p className="auth-hint" data-testid="passkey-unsupported">
        This browser can’t save a passkey. Nothing is lost: codes by email keep working everywhere.
      </p>
    );
  }
  return (
    <section className="auth-field" aria-labelledby="passkey-heading" data-testid="passkey-enroll">
      <h2 id="passkey-heading" className="auth-label">
        Confirm it’s you faster (optional)
      </h2>
      <p className="auth-hint">When we ask you to confirm it’s you — before changing your email or claiming a ride — a passkey lets you use Face ID, Touch ID, or your device lock instead of waiting for a code. Codes always keep working.</p>
      {status === 'done' ? (
        <p className="auth-notice auth-notice-success" role="status" data-testid="passkey-done">
          Passkey saved for this device.
        </p>
      ) : (
        <div className="auth-actions">
          <button type="button" className="auth-button auth-button-ghost" onClick={enroll} disabled={status === 'working'} data-testid="passkey-add">
            {status === 'working' ? 'Waiting for your device…' : 'Add a passkey'}
          </button>
          {status === 'step_up' ? (
            <a className="auth-link" href="/step-up?next=%2Fclaim%2Fpasskey">
              Confirm it’s you first
            </a>
          ) : null}
        </div>
      )}
      {status === 'error' && message ? (
        <p className="auth-error" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
