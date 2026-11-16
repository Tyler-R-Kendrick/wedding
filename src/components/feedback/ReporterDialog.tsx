'use client';

import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { publicEnv } from '@/lib/env.public';
import type { Diagnostics } from '@/lib/diagnostics/types';
import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, MAX_MESSAGE_CHARS, REPORTER_HOTKEY, type FeedbackKind } from '@/lib/feedback/constants';
import { captureDiagnostics, prepareScreenshot, reportAsText, sendReport, type ReportOutcome, type ReportRequest } from './reporter-client';
import '@/components/rsvp/recipes.css';
import './reporter.css';

/**
 * The reporter's dialog: what happened, what kind of thing it is, an optional screenshot.
 *
 * A native <dialog>, so focus is trapped and returned and Escape closes it without any of the
 * site's own code. What is typed survives closing it; only a report that was sent clears the form.
 * The flight recorder's snapshot is taken as the dialog opens, so it describes what led up to the
 * report rather than the act of writing it.
 */
type Phase = { at: 'form'; problem?: string; unrecognised?: boolean } | { at: 'sending' } | { at: 'done'; outcome: Extract<ReportOutcome, { status: 'sent' | 'saved' }> };

export function ReporterDialog({ request }: { request: ReportRequest & { n: number } }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const diagnostics = useRef<Diagnostics | null>(null);
  const titleId = useId();
  const hintId = useId();
  const messageId = useId();
  const fileId = useId();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; label: string } | null>(null);
  const [shotProblem, setShotProblem] = useState('');
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const [copied, setCopied] = useState(false);

  // Each request opens the dialog. `n` changes even when the same page asks twice.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    diagnostics.current = captureDiagnostics();
    if (!el.open) el.showModal();
    area.current?.focus();
  }, [request.n]);

  const reset = () => {
    setKind('bug');
    setMessage('');
    setShot(null);
    setShotProblem('');
    setCopied(false);
    setPhase({ at: 'form' });
  };

  const attach = async (file: Blob | null | undefined, name: string) => {
    if (!file) return;
    const prepared = await prepareScreenshot(file);
    if (!prepared) {
      setShot(null);
      setShotProblem('That file is not a picture this can send. Try a PNG or JPEG screenshot.');
      return;
    }
    setShotProblem('');
    setShot({ blob: prepared, label: `${name} (${Math.max(1, Math.round(prepared.size / 1024))} KB)` });
  };

  const onPaste = (e: ClipboardEvent<HTMLDialogElement>) => {
    const image = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (!image) return;
    e.preventDefault();
    void attach(image, 'Pasted picture');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) {
      setPhase({ at: 'form', problem: 'Say what happened before sending.' });
      area.current?.focus();
      return;
    }
    setPhase({ at: 'sending' });
    const outcome = await sendReport({ kind, message: text, diagnostics: diagnostics.current ?? captureDiagnostics(), screenshot: shot?.blob ?? null });
    if (outcome.status === 'sent' || outcome.status === 'saved') setPhase({ at: 'done', outcome });
    else if (outcome.status === 'unrecognised') setPhase({ at: 'form', unrecognised: true, problem: 'This device is no longer recognised as yours. Sign in again, then send: what you wrote stays here.' });
    else setPhase({ at: 'form', problem: outcome.message });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportAsText({ kind, message: message.trim(), diagnostics: diagnostics.current ?? captureDiagnostics() }));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const close = () => dialog.current?.close();
  const onClose = () => {
    if (phase.at === 'done') reset();
  };

  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const theme = document.documentElement.dataset.theme || publicEnv.defaultTheme;
  const sending = phase.at === 'sending';
  const problem = phase.at === 'form' ? phase.problem : undefined;
  const emptyMessage = problem !== undefined && !message.trim();

  return (
    <dialog ref={dialog} className="reporter" data-theme={theme} aria-labelledby={titleId} onClose={onClose} onPaste={onPaste}>
      <form className="reporter__panel" onSubmit={submit} noValidate>
        <div className="reporter__head">
          <h2 id={titleId} className="reporter__title">
            Report a problem
          </h2>
          <button type="button" className="btn btn--ghost reporter__close" onClick={close}>
            Close
          </button>
        </div>

        {phase.at === 'done' ? (
          <>
            <p className="reporter__done" role="status">
              {phase.outcome.status === 'sent'
                ? `Thank you. ${phase.outcome.message}`
                : 'The site could not be reached, so this report is saved on this device and will be sent the next time a page loads here.'}
            </p>
            {phase.outcome.status === 'sent' ? <p className="reporter__ref">Reference: {phase.outcome.ref}</p> : null}
            <div className="actions">
              {phase.outcome.status === 'sent' && phase.outcome.issue ? (
                <a className="btn btn--secondary" href={phase.outcome.issue.url} target="_blank" rel="noreferrer">
                  Open {phase.outcome.issue.key}
                </a>
              ) : null}
              {phase.outcome.status === 'saved' ? (
                <button type="button" className="btn btn--secondary" onClick={copy}>
                  {copied ? 'Copied' : 'Copy the report'}
                </button>
              ) : null}
              <button type="button" className="btn btn--primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {problem ? (
              <p className="reporter__alert" role="alert">
                {problem} {phase.at === 'form' && phase.unrecognised ? <a href="/sign-in">Sign in</a> : null}
              </p>
            ) : null}

            <fieldset className="fld">
              <legend className="fld__label">What kind of thing is it?</legend>
              <div className="choice">
                {FEEDBACK_KINDS.map((k) => (
                  <label key={k} className="choice__opt">
                    <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                    {FEEDBACK_KIND_LABELS[k]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={`fld${emptyMessage ? ' fld--error' : ''}`}>
              <label className="fld__label" htmlFor={messageId}>
                What happened?
              </label>
              <p className="fld__hint" id={hintId}>
                What you saw, and what you expected. One thing per report.
              </p>
              <textarea
                ref={area}
                id={messageId}
                className="inp inp--area"
                rows={6}
                maxLength={MAX_MESSAGE_CHARS}
                required
                aria-describedby={hintId}
                aria-invalid={emptyMessage || undefined}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            <div className="fld">
              <label className="fld__label" htmlFor={fileId}>
                Screenshot <span className="fld__req">(optional)</span>
              </label>
              <p className="fld__hint">Choose a picture, or paste one anywhere in this box.</p>
              {shotProblem ? <p className="fld__error">{shotProblem}</p> : null}
              <div className="reporter__file">
                <input id={fileId} type="file" accept="image/*" onChange={(e) => void attach(e.target.files?.[0], e.target.files?.[0]?.name ?? 'Picture')} />
                {shot ? (
                  <>
                    <span>Attached: {shot.label}</span>
                    <button type="button" className="btn btn--ghost reporter__close" onClick={() => setShot(null)}>
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <p className="reporter__note">
              Sent with your words: this page’s address, your browser and screen size, and the last steps and errors on this page{request.digest ? `, including this page’s error reference (${request.digest})` : ''}. Nothing typed into the site.
            </p>

            <div className="actions">
              <button type="submit" className="btn btn--primary" disabled={sending}>
                {sending ? 'Sending…' : 'Send report'}
              </button>
            </div>
            <p className="reporter__hint">
              Open this from any page with <kbd>{mac ? REPORTER_HOTKEY.macLabel : REPORTER_HOTKEY.label}</kbd>.
            </p>
          </>
        )}
      </form>
    </dialog>
  );
}
