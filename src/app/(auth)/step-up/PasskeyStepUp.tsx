'use client';

import { useState, useSyncExternalStore } from 'react';
import { passkeyStepUpOptions, passkeyStepUpVerify } from '../_lib/actions';

/** Passkey half of step-up; falls back to the OTP form when the browser lacks WebAuthn JSON helpers. */
const noop = () => () => {};
const hasRequestJson = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && typeof (window.PublicKeyCredential as unknown as { parseRequestOptionsFromJSON?: unknown }).parseRequestOptionsFromJSON === 'function';

export function PasskeyStepUp({ next }: { next: string }) {
  const supported = useSyncExternalStore(noop, hasRequestJson, () => false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!supported) return null;
  async function run() {
    setBusy(true);
    setMessage('');
    try {
      const opts = await passkeyStepUpOptions();
      if (!opts.ok) {
        setMessage(opts.message);
        return;
      }
      const PKC = window.PublicKeyCredential as unknown as { parseRequestOptionsFromJSON: (json: unknown) => PublicKeyCredentialRequestOptions };
      const publicKey = PKC.parseRequestOptionsFromJSON(opts.options);
      const assertion = (await navigator.credentials.get({ publicKey })) as (PublicKeyCredential & { toJSON(): Record<string, unknown> }) | null;
      if (!assertion) {
        setMessage('No passkey was used.');
        return;
      }
      const verified = await passkeyStepUpVerify(assertion.toJSON() as unknown as Record<string, unknown>);
      if (!verified.ok) {
        setMessage(verified.message);
        return;
      }
      window.location.assign(next);
    } catch {
      setMessage('That didn’t go through. You can use a code instead.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-field">
      <div className="auth-actions">
        <button type="button" className="auth-button auth-button-primary" onClick={run} disabled={busy} data-testid="stepup-passkey">
          {busy ? 'Waiting for your device…' : 'Use my passkey'}
        </button>
      </div>
      {message ? (
        <p className="auth-error" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
