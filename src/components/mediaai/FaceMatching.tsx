'use client';

import { useId, useState } from 'react';
import type { MyUploadItem } from '@/capabilities/media';
import type { FindPhotosOfMeResult, MyBiometricConsent } from '@/capabilities/biometrics';
import { newId } from '@/contracts/ids';
import { callCapability } from '../media/capabilityClient';
import { callConsent } from './consentClient';
import './mediaai.css';

type Notice = { tone: 'info' | 'error'; text: string } | null;

const UNAVAILABLE: Record<string, string> = {
  flag_off: 'Finding photos of yourself is switched off. It stays off until the couple and their lawyer have signed off on how facial data would be handled.',
  readiness_off: 'Finding photos of yourself is not switched on yet: the legal review of how facial data would be handled is still outstanding.',
};

/**
 * The opt-in surface for face matching (ADR-0006). It is honest in three directions: it says
 * plainly when the feature cannot run, it shows the exact consent text that gets recorded before
 * anything is collected, and it offers withdrawal and deletion even when the feature is off.
 */
export function FaceMatching({ initial, candidates }: { initial: MyBiometricConsent; candidates: MyUploadItem[] }) {
  const [view, setView] = useState(initial);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await callCapability<MyBiometricConsent>('get_my_biometric_consent', {});
    if (r.ok) setView(r.data);
  }

  async function withdraw(action: 'revoke' | 'delete') {
    setBusy(true);
    setNotice(null);
    const r = await callConsent<{ deletion: { id: string } | null }>(action, {});
    setBusy(false);
    if (!r.ok) return setNotice({ tone: 'error', text: r.error.message });
    await refresh();
    setNotice({ tone: 'info', text: action === 'revoke' ? 'Your consent is withdrawn. Anything held about your face is queued for deletion.' : 'Deletion requested. You will see the record below once it completes.' });
  }

  const usable = view.available && view.consent.status === 'active';

  return (
    <div className="mi-panel">
      <h3>Finding photos of yourself</h3>

      {!view.available ? (
        <p className="mi-notice">{UNAVAILABLE[view.unavailableReason ?? 'flag_off'] ?? UNAVAILABLE['flag_off']}</p>
      ) : view.consent.status === 'active' ? (
        <p>You agreed to face matching on {formatDate(view.consent.record?.grantedAt)}. You can withdraw at any time.</p>
      ) : (
        <ConsentForm
          policy={view.policy}
          superseded={view.consent.supersededBy}
          busy={busy}
          setBusy={setBusy}
          onDone={async (text) => {
            await refresh();
            setNotice({ tone: 'info', text });
          }}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
      )}

      {notice ? (
        <p className="mi-notice" data-tone={notice.tone === 'error' ? 'error' : undefined} role="status">
          {notice.text}
        </p>
      ) : null}

      {usable ? <Enrolment view={view} candidates={candidates} busy={busy} setBusy={setBusy} refresh={refresh} setNotice={setNotice} /> : null}

      {view.consent.status !== 'none' || view.hasData ? (
        <div className="media-actions">
          {view.consent.status === 'active' ? (
            <button type="button" className="media-button media-button--secondary" onClick={() => void withdraw('revoke')} disabled={busy}>
              Withdraw consent
            </button>
          ) : null}
          <button type="button" className="media-button media-button--danger" onClick={() => void withdraw('delete')} disabled={busy}>
            Delete my facial data
          </button>
        </div>
      ) : null}

      {view.deletions.length ? (
        <div>
          <h4>Deletion record</h4>
          <ul className="mi-checklist">
            {view.deletions.map((d) => (
              <li key={d.id}>
                <span className="mi-checklist__mark" aria-hidden="true">
                  {d.status === 'completed' ? '✓' : '·'}
                </span>
                <span>
                  Requested {formatDate(d.requestedAt)} ({d.reason.replaceAll('_', ' ')}) — {d.status}
                  {d.proof ? <small>{d.proof.identityRefsDeleted} reference(s), {d.proof.matchesDeleted} match(es), {d.proof.providerSubjectsDeleted} provider record(s) and {d.proof.cachedResponsesDeleted} saved result(s) deleted.</small> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ConsentForm({
  policy,
  superseded,
  busy,
  setBusy,
  onDone,
  onError,
}: {
  policy: MyBiometricConsent['policy'];
  superseded: string | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDone: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  const id = useId();
  const [adult, setAdult] = useState(false);
  if (!policy) return null;

  async function agree() {
    if (!policy) return;
    setBusy(true);
    const draft = await callConsent<{ grant: { policyVersion: string; textHash: string; adultAttested: true } }>('draft', { adultAttested: true });
    if (!draft.ok) {
      setBusy(false);
      return onError(draft.error.message);
    }
    const token = draft.confirmation?.token;
    if (!token) {
      setBusy(false);
      return onError('We could not start the agreement. Please reload the page and try again.');
    }
    const granted = await callConsent('grant', draft.data.grant, { confirmationToken: token });
    setBusy(false);
    if (!granted.ok) return onError(granted.error.message);
    await onDone('Thank you. Your agreement is recorded, with the exact wording you read.');
  }

  return (
    <div className="mi-policy-block">
      {superseded ? <p className="mi-notice">We have updated this wording since you last agreed. Please read it again.</p> : null}
      <dl className="mi-policy">
        <dt>What it does</dt>
        <dd>{policy.purpose}</dd>
        <dt>For how long</dt>
        <dd>{policy.term}</dd>
        <dt>Deletion</dt>
        <dd>{policy.retention}</dd>
        <dt>What we keep afterwards</dt>
        <dd>{policy.results}</dd>
        <dt>Who processes it</dt>
        <dd>{policy.providerDisclosure}</dd>
      </dl>
      <details>
        <summary>Read the exact wording that gets recorded (version {policy.version})</summary>
        <p className="mi-policy__text">{policy.text}</p>
      </details>
      <label className="mi-check" htmlFor={`${id}-adult`}>
        <input id={`${id}-adult`} type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>{policy.minors}</span>
      </label>
      <div className="media-actions">
        <button type="button" className="media-button" onClick={() => void agree()} disabled={!adult || busy}>
          {busy ? 'Recording…' : 'I have read this and I agree'}
        </button>
      </div>
    </div>
  );
}

function Enrolment({
  view,
  candidates,
  busy,
  setBusy,
  refresh,
  setNotice,
}: {
  view: MyBiometricConsent;
  candidates: MyUploadItem[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  refresh: () => Promise<void>;
  setNotice: (n: Notice) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [matched, setMatched] = useState<FindPhotosOfMeResult | null>(null);
  const usable = candidates.filter((c) => c.assetId && c.kind === 'image' && c.thumb);

  async function enroll() {
    setBusy(true);
    setNotice(null);
    const r = await callCapability('enroll_biometric_reference', { assetIds: picked }, { mutation: true, idempotencyKey: newId() });
    setBusy(false);
    if (!r.ok) return setNotice({ tone: 'error', text: r.error.message });
    await refresh();
    setNotice({ tone: 'info', text: 'Saved. You can change these photos or delete everything at any time.' });
  }

  async function find() {
    setBusy(true);
    setNotice(null);
    const ids = usable.map((c) => c.assetId!).slice(0, 40);
    const r = await callCapability<FindPhotosOfMeResult>('find_photos_of_me', { candidateAssetIds: ids }, { mutation: true, idempotencyKey: newId() });
    setBusy(false);
    if (!r.ok) return setNotice({ tone: 'error', text: r.error.message });
    setMatched(r.data);
  }

  if (usable.length === 0) {
    return <p className="mi-notice">Add a photo of yourself from the upload page first; we only ever use your own uploads as the reference.</p>;
  }

  return (
    <div>
      <h4>{view.enrolment ? 'Your reference photos' : 'Pick up to three photos of yourself'}</h4>
      <p className="media-lede">These are the only photos used to build your reference. Choose ones where your face is clear.</p>
      <ul className="mi-picker">
        {usable.slice(0, 24).map((c) => {
          const id = c.assetId!;
          const checked = picked.includes(id);
          return (
            <li key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={c.caption ?? c.filename}
                  onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, id].slice(0, 3) : prev.filter((x) => x !== id)))}
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
                <img src={c.thumb!.url} alt="" width={c.thumb!.width ?? 200} height={c.thumb!.height ?? 200} loading="lazy" decoding="async" />
                {checked ? <span className="mi-picker__label">Reference</span> : null}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="media-actions">
        <button type="button" className="media-button" onClick={() => void enroll()} disabled={picked.length === 0 || busy}>
          {view.enrolment ? 'Replace my reference' : 'Use these photos'}
        </button>
        {view.enrolment ? (
          <button type="button" className="media-button media-button--secondary" onClick={() => void find()} disabled={busy}>
            Check my photos for me
          </button>
        ) : null}
      </div>
      {matched ? (
        <p className="mi-notice" role="status">
          Checked {matched.checked} photo{matched.checked === 1 ? '' : 's'} you can see and found {matched.matched.length}.
          {matched.skipped.length ? ` ${matched.skipped.length} were skipped (not yours to see, or a photographer's photo we may not process).` : ''}
        </p>
      ) : null}
    </div>
  );
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'an earlier date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an earlier date' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
