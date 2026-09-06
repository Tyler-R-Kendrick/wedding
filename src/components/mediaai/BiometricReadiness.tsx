'use client';

import { useState } from 'react';
import type { BiometricStatusView } from '@/capabilities/biometrics';
import { newId } from '@/contracts/ids';
import { callConfirmable } from './consentClient';
import './mediaai.css';

/**
 * The persisted half of the biometrics gate. Switching it on demands a written counsel reference,
 * and the environment flag is still the other half: neither alone turns anything on.
 */
export function BiometricReadiness({ status }: { status: BiometricStatusView }) {
  const [ready, setReady] = useState(status.readiness);
  const [recorded, setRecorded] = useState(status.counselReviewRef);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function enable() {
    setBusy(true);
    setNotice(null);
    // Two steps, like the guest-facing grant: draft the decision, then redeem its single-use token.
    const drafted = await callConfirmable<{ readiness: { counselReviewRef: string }; consequences: string[] }>(
      'draft_biometric_readiness',
      { counselReviewRef: reference.trim() },
    );
    if (!drafted.ok) {
      setBusy(false);
      return setNotice(drafted.error.message);
    }
    if (!drafted.confirmation?.token) {
      setBusy(false);
      return setNotice('We could not start that change. Please reload the page and try again.');
    }
    const r = await callConfirmable<{ readiness: boolean; enabled: boolean; counselReviewRef: string | null }>(
      'admin_enable_biometric_readiness',
      drafted.data.readiness,
      { mutation: true, idempotencyKey: newId(), confirmationToken: drafted.confirmation.token },
    );
    setBusy(false);
    if (!r.ok) return setNotice(r.error.message);
    setReady(r.data.readiness);
    setRecorded(r.data.counselReviewRef);
    setNotice(r.data.enabled ? 'Face matching is now switched on for guests who opt in.' : 'Recorded, but FLAG_BIOMETRICS_ENABLED is off, so nothing can run.');
  }

  async function disable() {
    setBusy(true);
    setNotice(null);
    const r = await callConfirmable<{ readiness: boolean; enabled: boolean }>('admin_disable_biometric_readiness', {}, { mutation: true, idempotencyKey: newId() });
    setBusy(false);
    if (!r.ok) return setNotice(r.error.message);
    setReady(r.data.readiness);
    setRecorded(null);
    setNotice('The readiness switch is off. No face matching can run.');
  }

  return (
    <div className="mi-panel">
      <h3>Readiness switch</h3>
      <p>
        Environment flag <strong>{status.flag ? 'on' : 'off'}</strong> · readiness switch <strong>{ready ? 'on' : 'off'}</strong> · feature{' '}
        <strong>{status.flag && ready ? 'live' : 'off'}</strong>. Both halves are required, and every guest must still opt in individually.
      </p>
      {ready ? (
        <>
          <p>
            Recorded review: <strong>{recorded ?? 'none recorded — switch off and on again with a reference'}</strong>
          </p>
          <div className="media-actions">
            <button type="button" className="media-button media-button--danger" onClick={() => void disable()} disabled={busy}>
              Switch readiness off
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="media-field">
            <span>Counsel review reference (ADR-0006 §7)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="e.g. review memo of 2027-01-14, filed as ADR-0006 addendum" aria-describedby="counsel-hint" />
          </label>
          <p className="mi-suggestion__meta" id="counsel-hint">
            A URL, an ADR section, a ticket, or a dated memo reference — something a person can go and read. It is stored on the flag row and shown here.
          </p>
          <div className="media-actions">
            <button type="button" className="media-button" onClick={() => void enable()} disabled={busy || reference.trim().length < 12}>
              Switch readiness on
            </button>
          </div>
        </>
      )}
      {notice ? <p className="mi-notice" role="status">{notice}</p> : null}
    </div>
  );
}
