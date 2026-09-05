'use client';

import { useState } from 'react';
import type { BiometricStatusView } from '@/capabilities/biometrics';
import { newId } from '@/contracts/ids';
import { callCapability } from '../media/capabilityClient';
import './mediaai.css';

/**
 * The persisted half of the biometrics gate. Switching it on demands a written counsel reference,
 * and the environment flag is still the other half: neither alone turns anything on.
 */
export function BiometricReadiness({ status }: { status: BiometricStatusView }) {
  const [ready, setReady] = useState(status.readiness);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(next: boolean) {
    setBusy(true);
    setNotice(null);
    const r = await callCapability<{ readiness: boolean; enabled: boolean }>(
      'admin_set_biometric_readiness',
      { ready: next, ...(next ? { counselReviewRef: reference.trim() } : {}) },
      { mutation: true, idempotencyKey: newId() },
    );
    setBusy(false);
    if (!r.ok) return setNotice(r.error.message);
    setReady(r.data.readiness);
    setNotice(r.data.enabled ? 'Face matching is now switched on for guests who opt in.' : 'The readiness switch is off. No face matching can run.');
  }

  return (
    <div className="mi-panel">
      <h3>Readiness switch</h3>
      <p>
        Environment flag <strong>{status.flag ? 'on' : 'off'}</strong> · readiness switch <strong>{ready ? 'on' : 'off'}</strong> · feature{' '}
        <strong>{status.flag && ready ? 'live' : 'off'}</strong>. Both halves are required, and every guest must still opt in individually.
      </p>
      {ready ? (
        <div className="media-actions">
          <button type="button" className="media-button media-button--danger" onClick={() => void submit(false)} disabled={busy}>
            Switch readiness off
          </button>
        </div>
      ) : (
        <>
          <label className="media-field">
            <span>Counsel review reference (ADR-0006 §7)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="e.g. review memo of 2027-01-14, filed as ADR-0006 addendum" />
          </label>
          <div className="media-actions">
            <button type="button" className="media-button" onClick={() => void submit(true)} disabled={busy || reference.trim().length < 3}>
              Switch readiness on
            </button>
          </div>
        </>
      )}
      {notice ? <p className="mi-notice" role="status">{notice}</p> : null}
    </div>
  );
}
