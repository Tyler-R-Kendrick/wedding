'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import { clearDraft, readDraft, writeDraft } from './draft';
import './flow.css';

export type FieldErrors = Record<string, string>;

export interface FlowContext<V> {
  values: V;
  set: (patch: Partial<V>) => void;
  errors: FieldErrors;
  busy: boolean;
  /**
   * Prefix for this flow's element ids, so two flows on one page never share an id. Fields use
   * `${uid}-${name}`; the sheet's own ids use a double dash (`${uid}--sheet-title`), so a field named
   * `title` or `step` can never take the heading's id and leave its label pointing at the heading.
   */
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
  /** Continue checks this first (a required confirmation, a choice not yet made)… */
  ready?: (values: V) => boolean;
  /**
   * …and says this when it does not hold, beside `field` when given. Continue is never a dead,
   * disabled button with no reason: the review of this kit found exactly that.
   */
  readyHint?: { field?: keyof V & string; message: string };
}

export interface AdminFlowProps<V> {
  /** The draft's key. Include the record's id when editing one, so two edits keep two drafts. */
  id: string;
  title: string;
  trigger: {
    label: string;
    variant?: 'primary' | 'ghost' | 'quiet' | 'danger';
    describedBy?: string;
    /** For a row's "Edit" or "Delete": the name a screen reader hears ("Delete Ada Lovelace"). */
    accessibleName?: string;
  };
  initial: V;
  steps: FlowStep<V>[];
  /**
   * `danger`: the flow deletes, revokes, resets or merges something. The final button is red and
   * says what it does, and nothing is kept as a draft while it is open — a half-finished deletion
   * is not something to come back to. (A trip to /step-up still resumes it: that is the same
   * decision, interrupted.)
   */
  tone?: 'default' | 'danger';
  /** Keep a draft while the flow is unfinished. Defaults to true, and to false for `danger`. */
  durable?: boolean;
  /**
   * What is typed here (ride codes, a guest list full of addresses) is never written to this device,
   * not even to survive a trip to /step-up: implies `durable={false}`, and a step-up detour says the
   * answers will need entering again rather than keeping them.
   */
  secret?: boolean;
  /**
   * Fetches what the form starts from when the sheet opens (an edit needs the whole record; the
   * list only carried a summary). Not called when a draft is being resumed: the draft is newer.
   * Return a message string instead of values to say why it could not be loaded.
   */
  load?: () => Promise<Partial<V> | string>;
  /** Open on arrival (a `/new` route whose whole job is this flow). A resumed draft opens anyway. */
  defaultOpen?: boolean;
  submit: {
    /** The last step's button. A function when it names something chosen earlier ("Publish RSVP_OPEN"). */
    label: string | ((values: V) => string);
    /** The capability the last step calls, with `input(values)`… */
    capability?: string;
    input?: (values: V) => unknown;
    /** …or a caller that makes the call itself (two saves in order, a confirmation token). */
    run?: (values: V) => Promise<CapabilityResponse>;
    /** For a capability that needs the token a review step was issued (lifecycle publishing). */
    confirmationToken?: (values: V) => string | undefined;
    /** Said once the save lands; announced next to the button that opened the flow. */
    success: string;
    /**
     * Something to show before the sheet closes: a link that is shown only once, an import's
     * counts. Without it the sheet closes on success and the page refreshes behind it.
     */
    result?: (data: unknown, values: V) => ReactNode;
    /** Called with the capability's data once the save lands (a list that re-reads, a count). */
    onSuccess?: (data: unknown, values: V) => void;
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
export function AdminFlow<V extends Record<string, unknown>>({ id, title, trigger, initial: given, steps, submit, tone = 'default', durable: durableProp, secret = false, load, defaultOpen = false }: AdminFlowProps<V>) {
  const durable = !secret && (durableProp ?? tone !== 'danger');
  const router = useRouter();
  const uid = useId().replace(/:/g, '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  // What "unchanged" means: the given starting values, or what `load` fetched for this record.
  const [initial, setInitial] = useState<V>(given);
  const [values, setValues] = useState<V>(given);
  const [loading, setLoading] = useState(false);
  // New starting values from the server — a save refreshed the page, so an edit's record changed.
  // A closed flow the admin has not touched starts from them; an open one, or one holding a draft,
  // keeps what was typed. Adjusted during render (React's pattern for props that reset state), so
  // the next open never shows the record as it was before the save.
  const givenKey = JSON.stringify(given);
  const [seenGiven, setSeenGiven] = useState(givenKey);
  if (givenKey !== seenGiven) {
    setSeenGiven(givenKey);
    if (!open && JSON.stringify(values) === JSON.stringify(initial)) {
      setInitial(given);
      setValues(given);
    }
  }
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<Direction>('forward');
  const [notice, setNotice] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [result, setResult] = useState<ReactNode | null>(null);
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
    if (durable && dirty) writeDraft(id, { values, step, open });
  }, [id, values, step, open, dirty, durable]);

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
        // A sheet that opened itself (a restored draft, the return from /step-up) had nothing focused
        // before it, so the browser would drop focus to <body>. The button that opens it is where it lives.
        const active = document.activeElement;
        if (!active || active === document.body || d.contains(active)) triggerRef.current?.focus();
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

  const start = async () => {
    setAnnounce(null);
    setOpen(true);
    if (!load || dirty || hasDraft) return;
    setLoading(true);
    setFormError(null);
    const loaded = await load();
    setLoading(false);
    if (typeof loaded === 'string') {
      setFormError(loaded);
      return;
    }
    const base = { ...given, ...loaded } as V;
    setInitial(base);
    setValues(base);
  };

  // Open on arrival, once, when there is no draft to resume (a draft reopens itself above).
  const arrived = useRef(false);
  useEffect(() => {
    if (!defaultOpen || arrived.current) return;
    arrived.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening needs the browser, after hydration, exactly once
    if (!readDraft(id)) void start();
    // Arrival happens once per mount; `start` is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    setOpen(false);
    setNotice(null);
    if (result !== null || !durable) {
      // A finished flow, or one that keeps nothing, starts over next time.
      setResult(null);
      setStep(0);
      setValues(initial);
      setErrors({});
      setFormError(null);
      if (!durable) clearDraft(id);
    }
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
    if (busy) return;
    setFormError(null);
    if (!ready) {
      const hint = current.readyHint ?? { message: 'Please finish this step first.' };
      if (hint.field) {
        const errs = { [hint.field]: hint.message };
        setErrors(errs);
        focusFirstError(errs);
      } else setFormError(hint.message);
      return;
    }
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
    const res = submit.run
      ? await submit.run(values)
      : await callCapability(submit.capability ?? '', { input: submit.input ? submit.input(values) : {}, idempotencyKey: newIdempotencyKey(), confirmationToken: submit.confirmationToken?.(values) });
    setBusy(false);
    if (!res.ok) {
      if (res.error?.code === 'step_up_required') {
        if (secret) {
          setNotice('Taking you to confirm it’s you. What you typed here is not kept on this device, so you will need to enter it again when you come back.');
        } else {
          writeDraft(id, { values, step, open: true, stepUp: true });
          setNotice('Taking you to confirm it’s you. You will come straight back to this step with everything you typed.');
        }
        router.push(`/step-up?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const issues = (res.error?.details?.issues as { path: string; message: string }[] | undefined) ?? [];
      const byField: FieldErrors = {};
      // A nested path (`paragraphs.0`, `media[0].alt`) belongs to the field that holds it.
      for (const i of issues) {
        const field = i.path ? i.path.split(/[.[]/)[0]! : '';
        if (field && !byField[field]) byField[field] = i.message;
      }
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
    setNotice(null);
    setAnnounce(submit.success);
    submit.onSuccess?.(res.data, values);
    router.refresh();
    if (submit.result) {
      // Stay open on a "Done" panel: what it shows may be visible only this once.
      setResult(submit.result(res.data, values));
      setDirection('forward');
      window.requestAnimationFrame(() => headingRef.current?.focus());
      return;
    }
    setOpen(false);
    setStep(0);
    setValues(initial);
  };

  // Something unfinished is waiting: restored from an earlier visit, or typed and then closed.
  const unfinished = durable && (hasDraft || dirty) && result === null;
  const triggerClass =
    trigger.variant === 'quiet' ? 'flow-trigger-quiet' : trigger.variant === 'danger' ? 'flow-trigger-quiet flow-trigger-danger' : trigger.variant === 'ghost' ? 'ops-button ops-button-ghost' : 'ops-button ops-button-primary';
  const triggerName = trigger.accessibleName ? (unfinished && !open ? `Continue: ${trigger.accessibleName}` : trigger.accessibleName) : undefined;
  const single = steps.length === 1;
  const ctx: FlowContext<V> = { values, set, errors, busy, uid };

  return (
    <div className="flow-anchor">
      <button ref={triggerRef} type="button" className={triggerClass} onClick={start} aria-haspopup="dialog" aria-describedby={trigger.describedBy} aria-label={triggerName}>
        {unfinished && !open ? `Continue: ${trigger.label.charAt(0).toLowerCase()}${trigger.label.slice(1)}` : trigger.label}
      </button>
      {unfinished && !open ? <span className="flow-draft-note">Unfinished, kept on this device</span> : null}
      <p className="flow-announce" role="status">
        {announce}
      </p>

      <dialog
        ref={dialogRef}
        className="flow-sheet"
        data-tone={tone}
        aria-labelledby={`${uid}--sheet-title`}
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
              <p id={`${uid}--sheet-title`} className="flow-title">
                {title}
              </p>
              <button type="button" className="flow-close" onClick={dismiss}>
                Close{durable && result === null ? <span className="sr-only"> (your answers are kept)</span> : null}
              </button>
            </div>
            {!single && result === null ? (
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
            {result !== null ? (
              <section key="done" className="flow-step" data-direction="forward" aria-labelledby={`${uid}--step-title`}>
                <p className="flow-step__count">Done</p>
                <h2 id={`${uid}--step-title`} ref={headingRef} tabIndex={-1} className="flow-step__title">
                  {submit.success}
                </h2>
                <div className="flow-step__fields" role="status">
                  {result}
                </div>
              </section>
            ) : (
              <section key={step} className="flow-step" data-direction={direction} aria-labelledby={`${uid}--step-title`}>
                {!single ? (
                  <p className="flow-step__count">
                    Step {step + 1} of {steps.length}
                  </p>
                ) : null}
                <h2 id={`${uid}--step-title`} ref={headingRef} tabIndex={-1} className="flow-step__title">
                  {current.title}
                </h2>
                {current.lede ? <p className="flow-step__lede">{current.lede}</p> : null}
                <div className="flow-step__fields" aria-busy={loading || undefined}>
                  {loading ? <p className="flow-hint">Loading the current details…</p> : current.render(ctx)}
                </div>
              </section>
            )}
            {formError ? (
              <p className="flow-error" role="alert">
                {formError}
              </p>
            ) : null}
          </div>

          <footer className="flow-foot">
            {result !== null ? (
              <>
                <span />
                <button type="button" className="ops-button ops-button-primary" onClick={dismiss}>
                  Close
                </button>
              </>
            ) : (
              <>
                {dirty && durable ? (
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
                  <button type="submit" className={`ops-button ${last && tone === 'danger' ? 'ops-button-danger' : 'ops-button-primary'}`} disabled={busy || loading} aria-busy={busy || undefined}>
                    {busy ? (last ? 'Working…' : 'Checking…') : last ? (typeof submit.label === 'function' ? submit.label(values) : submit.label) : 'Continue'}
                  </button>
                </div>
              </>
            )}
          </footer>
        </form>
      </dialog>
    </div>
  );
}
