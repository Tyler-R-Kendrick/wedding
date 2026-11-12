'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { DIETS, PRICE_LEVELS, type Diet, type PriceLevel } from '@/domain/trip-planner';
import { BUDGET_LABEL, dietLabel, INTEREST_LABEL, INTERESTS, prefsOf, profileSummary, type Interest, type TripPrefs, type TripProfile } from '@/domain/trip-planner/profile';
import { Icon } from '@/themes/shared/icons';

/**
 * Who the planner is planning for, said in one line above the ideas, with one way to change it.
 * Everything shown is something the guest told us (at RSVP, or here); what came from the RSVP says
 * so. Changing it here changes only the planner's ideas, never the RSVP.
 *
 * The form opens in place, under the line, and closes back to it: no dialog, nothing moves but the
 * panel below. Saving is the page's job (`onSave`); this only gathers the answers.
 */
export function TripProfileBar({
  profile,
  open,
  busy,
  problem,
  onOpen,
  onClose,
  onSave,
  onClear,
}: {
  profile: TripProfile;
  open: boolean;
  /** A save is on its way. */
  busy: boolean;
  /** The last save did not go through, in words for the guest. */
  problem: string | null;
  onOpen: () => void;
  onClose: () => void;
  onSave: (prefs: TripPrefs) => void;
  /** Back to what the invitation and RSVP say. Absent when the guest has set nothing. */
  onClear?: () => void;
}) {
  const formId = useId();
  const summary = profileSummary(profile);
  const bare = summary.length === 1 && !profile.saved;
  const change = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  // Closing the form hands the keyboard back to the button that opened it, and leaves the line it
  // changed in view: the form is long on a phone, and "Save" is at the foot of it.
  useLayoutEffect(() => {
    if (wasOpen.current && !open) {
      change.current?.focus({ preventScroll: true });
      const el = root.current;
      const pinned = el?.closest('.trip-planner')?.querySelector('.trip-tabs')?.getBoundingClientRect().bottom ?? 0;
      if (el && typeof el.scrollIntoView === 'function' && (el.getBoundingClientRect().top < pinned || el.getBoundingClientRect().top > window.innerHeight * 0.6)) el.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section ref={root} className="trip-who" aria-label="Who we are planning for">
      <div className="trip-who__line">
        <p className="trip-who__for">
          <span className="trip-who__label">Planning for</span>
          <span className="trip-who__facts">
            {summary.map((f, i) => (
              <span key={f.key} className="trip-who__fact">
                {f.text}
                {f.from === 'rsvp' ? <span className="trip-who__from"> (from your RSVP)</span> : null}
                {i < summary.length - 1 ? <span aria-hidden="true" className="trip-who__dot" /> : null}
              </span>
            ))}
          </span>
        </p>
        <button ref={change} type="button" className="trip-link trip-who__change" aria-expanded={open} aria-controls={formId} onClick={open ? onClose : onOpen}>
          <Icon name="pencil" className="trip-icon trip-icon--sm" />
          {bare ? 'Make the ideas fit you' : 'Change'}
        </button>
      </div>
      {open ? <ProfileForm id={formId} profile={profile} busy={busy} problem={problem} onClose={onClose} onSave={onSave} {...(onClear ? { onClear } : {})} /> : null}
    </section>
  );
}

const BUDGETS: PriceLevel[] = PRICE_LEVELS.filter((l) => l < 4);

function ProfileForm({ id, profile, busy, problem, onClose, onSave, onClear }: { id: string; profile: TripProfile; busy: boolean; problem: string | null; onClose: () => void; onSave: (prefs: TripPrefs) => void; onClear?: () => void }) {
  // Every answer as it stands, as a definite one: saving the form says all of them.
  const [draft, setDraft] = useState(() => ({ ...prefsOf(profile), diet: profile.diet, stepFree: profile.stepFree, shortWalks: profile.shortWalks, kids: profile.kids }));
  const first = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    first.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, []);
  const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // "Children come along" is saved only when it differs from what the invitation says.
    onSave({ ...draft, kids: draft.kids === profile.party.children > 0 ? null : draft.kids, asked: true });
  };
  const chip = (on: boolean, label: string, press: () => void, key: string) => (
    <button key={key} type="button" className={`trip-chip trip-clarify__option${on ? ' is-picked' : ''}`} aria-pressed={on} onClick={press}>
      {on ? <Icon name="check" className="trip-icon trip-icon--sm" /> : null}
      {label}
    </button>
  );
  return (
    <form id={id} className="trip-who__form" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <fieldset ref={first} className="trip-choice">
        <legend className="trip-clarify__ask">Anything you do not eat?</legend>
        <div className="trip-clarify__options">{DIETS.map((d: Diet) => chip(draft.diet.includes(d), dietLabel(d), () => setDraft((p) => ({ ...p, diet: flip(p.diet, d) })), d))}</div>
        <p className="trip-caption trip-who__hint">This shapes the ideas here. Your RSVP and your meal at the wedding stay as you left them.</p>
      </fieldset>
      <fieldset className="trip-choice">
        <legend className="trip-clarify__ask">Most you would spend on a meal, each</legend>
        <div className="trip-clarify__options">
          {chip(draft.budget === null || draft.budget === 4, 'No limit', () => setDraft((p) => ({ ...p, budget: null })), 'any')}
          {BUDGETS.map((l) => chip(draft.budget === l, BUDGET_LABEL[l], () => setDraft((p) => ({ ...p, budget: l })), String(l)))}
        </div>
      </fieldset>
      <fieldset className="trip-choice">
        <legend className="trip-clarify__ask">Anything to plan around?</legend>
        <div className="trip-clarify__options">
          {chip(draft.stepFree, 'Step-free places only', () => setDraft((p) => ({ ...p, stepFree: !p.stepFree })), 'step')}
          {chip(draft.shortWalks, 'Keep it close to the hotel', () => setDraft((p) => ({ ...p, shortWalks: !p.shortWalks })), 'near')}
          {chip(draft.kids === true, 'Children come along', () => setDraft((p) => ({ ...p, kids: !p.kids })), 'kids')}
        </div>
      </fieldset>
      <fieldset className="trip-choice">
        <legend className="trip-clarify__ask">What do you enjoy?</legend>
        <div className="trip-clarify__options">{INTERESTS.map((i: Interest) => chip(draft.interests.includes(i), INTEREST_LABEL[i], () => setDraft((p) => ({ ...p, interests: flip(p.interests, i) })), i))}</div>
      </fieldset>
      {problem ? (
        <p className="trip-caption trip-who__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="trip-clarify__go trip-who__go">
        <button type="submit" className="trip-add" aria-disabled={busy ? true : undefined}>
          {busy ? 'Saving' : 'Save'}
        </button>
        <button type="button" className="trip-link" onClick={onClose}>
          Cancel
        </button>
        {onClear ? (
          <button type="button" className="trip-link trip-who__clear" aria-disabled={busy ? true : undefined} onClick={() => !busy && onClear()}>
            Clear my answers
          </button>
        ) : null}
      </div>
    </form>
  );
}
