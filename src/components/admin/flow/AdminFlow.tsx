'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { callCapability, newIdempotencyKey } from '@/components/handoff/client';
import { clearDraft, readDraft, writeDraft } from './draft';
import './flow.css';

export type FieldErrors = Record<string, string>;

export interface FlowContext<V> {
  values: V;
  set: (patch: Partial<V>) => void;
  errors: FieldErrors;
  busy: boolean;
  /** Prefix for this flow's element ids, so two flows on one page never share an id. */
  uid: string;
}

export interface FlowStep<V> {
  title: string;
  /** One line under the step's heading: what this step is for. */
  lede?: string;
  /** Fields this step owns. A server error naming one of them brings the admin back to this step. */
  fields?: (keyof V & string)[];
  render: (ctx: FlowContext<V>) => ReactNode;
  /** Runs on Continue. Return errors to stay on the step, or a patch (a normalised value) to keep. */
  next?: (values: V) => Promise<{ errors?: FieldErrors; patch?: Partial<V> } | void>;
  /** Continue stays disabled until this holds (a required confirmation, a choice not yet made). */
  ready?: (values: V) => boolean;
}

export interface AdminFlowProps<V> {
  /** The draft's key. Include the record's id when editing one, so two edits keep two drafts. */
  id: string;
  title: string;
  trigger: { label: string; variant?: 'primary' | 'ghost' | 'quiet'; describedBy?: string };
  initial: V;
  steps: FlowStep<V>[];
  submit: {
    label: string;
    capability: string;
    input: (values: V) => unknown;
    /** Said once the save lands; announced next to the button that opened the flow. */
    success: string;
  };
}

type Direction = 'forward' | 'back';

/**
 * A multi-step admin task in a sheet: one question per step, checked before moving on, saved once
 * at the end through one capability.
 *
 * It replaces the console's habit of printing every field of a record as one long form beside a
 * table of what is already there. That shape asked the couple to know the record's internals (an
 * "Id (slug)", an "Order" of 0/10/20/30, a "Still a placeholder" box) and told them nothing about
 * what guests would see until after they had saved.
 *
 * Durable: the flow's values and step are kept on this device (`draft.ts`) while it is unfinished,
 * so a reload, a closed sheet or the trip to /step-up — which every change to where money goes
 * requires — comes back to the same step with the same answers. Closing the sheet keeps the draft;
 * only Discard or a successful save throws it away.
 *
 * Motion is transform and opacity only, 180–240ms, and none at all under `prefers-reduced-motion`
 * (flow.css). Focus moves to each step's heading, so a screen reader hears where it is.
 */
export function AdminFlow<V extends Record<string, unknown>>({ id, title, trigger, initial, steps, submit }: AdminFlowProps<V>) {
  const router = useRouter();
  const uid = useId().replace(/:/g, '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<V>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<Direction>('forward');
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const hydrated = useRef(false);

  const dirty = step > 0 || JSON.stringify(values) !== JSON.stringify(initial);

  // Pick up a draft once, after hydration: the server cannot know what this tab left unfinished.
  useEffect(() => {
    const d = readDraft<V>(id);
    hydrated.current = true;
    if (!d) return;
    /* eslint-disable react-hooks/set-state-in-effect -- restoring browser-only state after hydration is the point */
    setValues({ ...initial, ...d.values });
    setStep(Math.min(d.step, steps.length - 1));
    setHasDraft(true);
    if (d.open || d.stepUp) {
      setOpen(true);
      setNotice(d.stepUp ? 'Thank you for confirming it’s you. Everything you typed is still here: check it and save.' : 'Picked up where you left off.');
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // `initial` and `steps` are rebuilt on every render of the parent; the draft key is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Keep the draft current while there is something worth keeping.
  useEffect(() => {
    if (!hydrated.current) return;
    if (dirty) writeDraft(id, { values, step, open });
  }, [id, values, step, open, dirty]);

  // The sheet is a native modal <dialog>: focus is contained, Escape works, and the page behind it is inert.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.removeAttribute('data-closing');
      d.showModal();
      headingRef.current?.focus();
    } else if (!open && d.open) {
      d.setAttribute('data-closing', '');
      const done = () => {
        d.removeAttribute('data-closing');
        if (d.open) d.close();
      };
      // The exit animation ends the close; the timer covers reduced motion, where there is none.
      d.addEventListener('animationend', done, { once: true });
      const t = window.setTimeout(done, 260);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [step, open]);

  const set = useCallback((patch: Partial<V>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  }, []);

  const start = () => {
    setAnnounce(null);
    setOpen(true);
  };

  const dismiss = () => {
    setOpen(false);
    setNotice(null);
  };

  const discard = () => {
    clearDraft(id);
    setHasDraft(false);
    setValues(initial);
    setStep(0);
    setErrors({});
    setFormError(null);
    setNotice(null);
    setOpen(false);
  };

  const current = steps[step]!;
  const last = step === steps.length - 1;
  const ready = current.ready ? current.ready(values) : true;

  const goBack = () => {
    setErrors({});
    setFormError(null);
    setDirection('back');
    setStep((s) => Math.max(0, s - 1));
  };

  const focusFirstError = (errs: FieldErrors) => {
    const first = Object.keys(errs)[0];
    if (!first) return;
    window.requestAnimationFrame(() => document.getElementById(`${uid}-${first}`)?.focus());
  };

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !ready) return;
    setFormError(null);
    if (!last) {
      if (current.next) {
        setBusy(true);
        const r = await current.next(values);
        setBusy(false);
        if (r?.errors && Object.keys(r.errors).length) {
          setErrors(r.errors);
          focusFirstError(r.errors);
          return;
        }
        if (r?.patch) setValues((v) => ({ ...v, ...r.patch }));
      }
      setErrors({});
      setNotice(null);
      setDirection('forward');
      setStep((s) => s + 1);
      return;
    }
    setBusy(true);
    const res = await callCapability(submit.capability, { input: submit.input(values), idempotencyKey: newIdempotencyKey() });
    setBusy(false);
    if (!res.ok) {
      if (res.error?.code === 'step_up_required') {
        writeDraft(id, { values, step, open: true, stepUp: true });
        setNotice('Taking you to confirm it’s you. You will come straight back to this step with everything you typed.');
        router.push(`/step-up?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const issues = (res.error?.details?.issues as { path: string; message: string }[] | undefined) ?? [];
      const byField: FieldErrors = {};
      for (const i of issues) if (i.path && !byField[i.path]) byField[i.path] = i.message;
      const owner = steps.findIndex((s) => s.fields?.some((f) => byField[f]));
      if (owner >= 0 && owner !== step) {
        setDirection('back');
        setStep(owner);
      }
      setErrors(byField);
      if (owner < 0 || !Object.keys(byField).length) setFormError(res.error?.message ?? 'That did not save. Please try again.');
      focusFirstError(byField);
      return;
    }
    clearDraft(id);
    setHasDraft(false);
    setOpen(false);
    setStep(0);
    setValues(initial);
    setNotice(null);
    setAnnounce(submit.success);
    router.refresh();
  };

  // Something unfinished is waiting: restored from an earlier visit, or typed and then closed.
  const unfinished = hasDraft || dirty;
  const triggerClass = trigger.variant === 'quiet' ? 'flow-trigger-quiet' : trigger.variant === 'ghost' ? 'ops-button ops-button-ghost' : 'ops-button ops-button-primary';
  const ctx: FlowContext<V> = { values, set, errors, busy, uid };

  return (
    <div className="flow-anchor">
      <button type="button" className={triggerClass} onClick={start} aria-haspopup="dialog" aria-describedby={trigger.describedBy}>
        {unfinished && !open ? `Continue: ${trigger.label.charAt(0).toLowerCase()}${trigger.label.slice(1)}` : trigger.label}
      </button>
      {unfinished && !open ? <span className="flow-draft-note">Unfinished, kept on this device</span> : null}
      <p className="flow-announce" role="status">
        {announce}
      </p>

      <dialog
        ref={dialogRef}
        className="flow-sheet"
        aria-labelledby={`${uid}-title`}
        onCancel={(e) => {
          e.preventDefault();
          dismiss();
        }}
        onClick={(e) => {
          // A click on the backdrop lands on the <dialog> itself; the sheet's content never does.
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        <form className="flow-frame" onSubmit={onSubmit} noValidate>
          <header className="flow-head">
            <div className="flow-head__row">
              <p id={`${uid}-title`} className="flow-title">
                {title}
              </p>
              <button type="button" className="flow-close" onClick={dismiss}>
                Close<span className="sr-only"> (your answers are kept)</span>
              </button>
            </div>
            {steps.length > 1 ? (
              <ol className="flow-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
                {steps.map((s, i) => (
                  <li key={s.title} data-state={i < step ? 'done' : i === step ? 'current' : 'todo'} aria-current={i === step ? 'step' : undefined}>
                    <span className="flow-progress__bar" aria-hidden="true" />
                    <span className="flow-progress__label">{s.title}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </header>

          <div className="flow-body">
            {notice ? (
              <p className="flow-notice" role="status">
                {notice}
              </p>
            ) : null}
            <section key={step} className="flow-step" data-direction={direction} aria-labelledby={`${uid}-step`}>
              <p className="flow-step__count">
                Step {step + 1} of {steps.length}
              </p>
              <h2 id={`${uid}-step`} ref={headingRef} tabIndex={-1} className="flow-step__title">
                {current.title}
              </h2>
              {current.lede ? <p className="flow-step__lede">{current.lede}</p> : null}
              <div className="flow-step__fields">{current.render(ctx)}</div>
            </section>
            {formError ? (
              <p className="flow-error" role="alert">
                {formError}
              </p>
            ) : null}
          </div>

          <footer className="flow-foot">
            {dirty ? (
              <button type="button" className="flow-discard" onClick={discard}>
                Discard
              </button>
            ) : (
              <span />
            )}
            <div className="flow-foot__nav">
              {step > 0 ? (
                <button type="button" className="ops-button ops-button-ghost" onClick={goBack} disabled={busy}>
                  Back
                </button>
              ) : null}
              <button type="submit" className="ops-button ops-button-primary" disabled={busy || !ready} aria-busy={busy || undefined}>
                {busy ? (last ? 'Saving…' : 'Checking…') : last ? submit.label : 'Continue'}
              </button>
            </div>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
