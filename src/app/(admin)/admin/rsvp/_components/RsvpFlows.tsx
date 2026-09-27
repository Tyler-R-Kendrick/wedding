'use client';

import { useEffect, useState } from 'react';
import { AdminFlow, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { readDraft, writeDraft } from '@/components/admin/flow/draft';
import { CheckField, ChoiceField, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import { ANSWER_WORDS } from './answers';

/** One guest × event pair a guest can answer (an invitation), with the answer on record if any. */
export interface AnswerSlot {
  guestId: string;
  displayName: string;
  householdName: string;
  eventId: string;
  eventName: string;
  plusOnePolicy: 'none' | 'named' | 'unnamed';
  status: 'accepted' | 'declined' | null;
  mealLabel: string | null;
  mealStale: boolean;
  plusOne: { attending: boolean; name: string | null; mealLabel: string | null } | null;
}

export interface MenuSummary {
  eventId: string;
  options: { id: string; label: string }[];
}

interface Values extends Record<string, unknown> {
  guestId: string;
  eventId: string;
  status: string;
  mealOptionId: string;
  plusOne: boolean;
  plusOneName: string;
  plusOneMealOptionId: string;
  reason: string;
}

const EMPTY: Values = { guestId: '', eventId: '', status: 'accepted', mealOptionId: '', plusOne: false, plusOneName: '', plusOneMealOptionId: '', reason: '' };

/**
 * The RSVP validator names its issues by the guest form's paths (`responses.0.plusOne.name`); the
 * flow's fields are flat. Renaming them lets a rejected meal or name land beside its own field.
 */
const FIELD_BY_SUFFIX: [string, keyof Values & string][] = [
  ['.plusOne.name', 'plusOneName'],
  ['.plusOne.mealOptionId', 'plusOneMealOptionId'],
  ['.plusOne', 'plusOne'],
  ['.mealOptionId', 'mealOptionId'],
  ['.status', 'status'],
];

async function recordAnswer(input: unknown): Promise<CapabilityResponse> {
  const res = await callCapability('admin_override_rsvp', { input, idempotencyKey: newIdempotencyKey() });
  const issues = res.error?.details?.issues as { path: string; message: string }[] | undefined;
  if (res.ok || !issues) return res;
  const renamed = issues.map((i) => ({ ...i, path: FIELD_BY_SUFFIX.find(([suffix]) => i.path.endsWith(suffix))?.[1] ?? i.path }));
  return { ...res, error: { ...res.error!, details: { ...res.error!.details, issues: renamed } } };
}

const ANSWERS = [
  { value: 'accepted', label: ANSWER_WORDS.accepted.label },
  { value: 'declined', label: ANSWER_WORDS.declined.label },
];

/** The draft key: one for the blank flow at the top, one per guest × event for a row's correction. */
const flowId = (pick?: { guestId: string; eventId: string }) => (pick ? `rsvp:override:${pick.guestId}:${pick.eventId}` : 'rsvp:override');

/**
 * Record or correct one answer after a phone call or an email: whose answer, what they said, why.
 *
 * This was one long form of every field at the bottom of the page: a guest list, an event list,
 * meal selects offering every event's menu at once, and a plus-one name box shown to guests who
 * may not bring anyone. The flow asks for the guest first, offers only the events they are invited
 * to, starts from the answer already on record, and asks about a plus-one and meals only where the
 * invitation and the menu allow them.
 */
export function RecordAnswerFlow({
  slots,
  menus,
  pick,
  defaultOpen = false,
}: {
  slots: AnswerSlot[];
  menus: MenuSummary[];
  /** A row's correction: this guest and event are already chosen, so the "Whose answer" step is skipped. */
  pick?: { guestId: string; eventId: string };
  defaultOpen?: boolean;
}) {
  const guests = [...new Map(slots.map((s) => [s.guestId, `${s.displayName} (${s.householdName})`])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  const slot = (v: Values) => slots.find((s) => s.guestId === v.guestId && s.eventId === v.eventId);
  const menu = (eventId: string) => menus.find((m) => m.eventId === eventId)?.options ?? [];
  const mealName = (eventId: string, id: string) => menu(eventId).find((m) => m.id === id)?.label ?? '';
  // Start from what is on record, so a correction changes only what the guest changed.
  const onRecord = (s: AnswerSlot): Partial<Values> => {
    const byLabel = (label: string | null | undefined) => (label ? (menu(s.eventId).find((m) => m.label === label)?.id ?? '') : '');
    return {
      status: s.status ?? 'accepted',
      mealOptionId: s.mealStale ? '' : byLabel(s.mealLabel),
      plusOne: s.plusOnePolicy !== 'none' && Boolean(s.plusOne?.attending),
      plusOneName: s.plusOne?.name ?? '',
      plusOneMealOptionId: byLabel(s.plusOne?.mealLabel),
    };
  };

  const steps: FlowStep<Values>[] = [
    {
      title: 'Whose answer',
      fields: ['guestId', 'eventId'],
      render: (ctx) => {
        const events = slots.filter((s) => s.guestId === ctx.values.guestId).map((s) => ({ value: s.eventId, label: s.eventName }));
        return (
          <>
            <SelectField ctx={ctx} name="guestId" label="Guest" options={guests} placeholder={guests.length ? 'Choose a guest' : 'Nobody is invited to anything yet'} />
            <SelectField
              ctx={ctx}
              name="eventId"
              label="Event"
              options={events}
              placeholder={ctx.values.guestId ? 'Choose an event' : 'Choose a guest first'}
              hint="Only the events this guest is invited to."
            />
          </>
        );
      },
      ready: (v) => Boolean(slot(v)),
      readyHint: { field: 'eventId', message: 'Choose a guest and one of their events.' },
      next: async (v) => ({ patch: onRecord(slot(v)!) }),
    },
    {
      title: 'Their answer',
      fields: ['status', 'mealOptionId', 'plusOne', 'plusOneName', 'plusOneMealOptionId'],
      render: (ctx) => {
        const s = slot(ctx.values);
        const meals = menu(ctx.values.eventId).map((m) => ({ value: m.id, label: m.label }));
        const attending = ctx.values.status === 'accepted';
        return (
          <>
            {s?.status ? (
              <p className="flow-copy">
                On record: {ANSWER_WORDS[s.status].label.toLowerCase()}
                {s.mealLabel ? `, ${s.mealLabel}${s.mealStale ? ' (from an older menu)' : ''}` : ''}.
              </p>
            ) : (
              <p className="flow-copy">No answer on record yet.</p>
            )}
            <ChoiceField ctx={ctx} name="status" legend={`Is ${s?.displayName ?? 'the guest'} coming to ${s?.eventName ?? 'the event'}?`} choices={ANSWERS} />
            {attending && meals.length ? <SelectField ctx={ctx} name="mealOptionId" label="Meal" options={meals} placeholder="Not chosen yet" hint="From the current menu." /> : null}
            {attending && s && s.plusOnePolicy !== 'none' ? (
              <>
                <CheckField ctx={ctx} name="plusOne" label="Bringing a guest" />
                {ctx.values.plusOne ? (
                  <>
                    <TextField ctx={ctx} name="plusOneName" label="Their guest’s name" optional={s.plusOnePolicy === 'unnamed'} />
                    {meals.length ? <SelectField ctx={ctx} name="plusOneMealOptionId" label="Their guest’s meal" options={meals} placeholder="Not chosen yet" /> : null}
                  </>
                ) : null}
              </>
            ) : null}
          </>
        );
      },
    },
    {
      title: 'Why, and save',
      fields: ['reason'],
      render: (ctx) => {
        const v = ctx.values;
        const s = slot(v);
        const attending = v.status === 'accepted';
        return (
          <>
            <TextField ctx={ctx} name="reason" label="Why" hint="Kept in the audit trail with your name. For example: “phoned on Tuesday”." />
            <ReviewList
              items={[
                { label: 'Guest', value: s ? `${s.displayName} (${s.householdName})` : '' },
                { label: 'Event', value: s?.eventName ?? '' },
                { label: 'Answer', value: attending ? ANSWER_WORDS.accepted.label : ANSWER_WORDS.declined.label },
                ...(attending && menu(v.eventId).length ? [{ label: 'Meal', value: mealName(v.eventId, v.mealOptionId) }] : []),
                ...(attending && s && s.plusOnePolicy !== 'none'
                  ? [{ label: 'Their guest', value: v.plusOne ? [v.plusOneName.trim() || 'Not named', mealName(v.eventId, v.plusOneMealOptionId)].filter(Boolean).join(', ') : 'Not bringing anyone' }]
                  : []),
              ]}
            />
          </>
        );
      },
      ready: (v) => v.reason.trim().length >= 3,
      readyHint: { field: 'reason', message: 'Say why, in a few words.' },
    },
  ];

  const picked = pick ? slots.find((x) => x.guestId === pick.guestId && x.eventId === pick.eventId) : undefined;
  return (
    <AdminFlow<Values>
      id={flowId(picked ? pick : undefined)}
      title={picked ? `Correct ${picked.displayName}’s answer for ${picked.eventName}` : 'Record or correct an answer'}
      trigger={
        picked
          ? { label: 'Correct', variant: 'quiet', accessibleName: `Correct ${picked.displayName}’s answer for ${picked.eventName}` }
          : { label: 'Record an answer', variant: 'primary' }
      }
      initial={picked ? { ...EMPTY, guestId: picked.guestId, eventId: picked.eventId, ...onRecord(picked) } : EMPTY}
      steps={picked ? steps.slice(1) : steps}
      defaultOpen={defaultOpen}
      submit={{
        label: 'Save answer',
        success: 'Answer saved.',
        run: (v) => {
          const s = slot(v);
          const attending = v.status === 'accepted';
          const plusOneAllowed = attending && s !== undefined && s.plusOnePolicy !== 'none';
          return recordAnswer({
            guestId: v.guestId,
            eventId: v.eventId,
            status: v.status,
            mealOptionId: attending ? v.mealOptionId || null : null,
            // A guest who may bring someone and does not is recorded as "not bringing anyone";
            // one who may not has no plus-one at all.
            plusOne: plusOneAllowed ? (v.plusOne ? { attending: true, name: v.plusOneName.trim() || null, mealOptionId: v.plusOneMealOptionId || null } : { attending: false, name: null, mealOptionId: null }) : null,
            reason: v.reason.trim(),
          });
        },
      }}
    />
  );
}

/**
 * A row's "Correct" in the answers table: the record-an-answer flow, with this guest and event
 * already chosen.
 *
 * A screen of answers is hundreds of rows, and a sheet per row would be hundreds of dialogs in the
 * page. So each row starts as a plain button; pressing it mounts the real flow for that one row,
 * which opens on arrival and stays mounted, so pressing it again reopens it and focus comes back to
 * it on close. The row carries only this guest's invitations and those events' menus.
 *
 * A row with a draft on this device (a reload with the sheet open, or a correction closed half
 * done) mounts its flow straight away, so the draft is picked up where it was left.
 */
export function CorrectAnswer({ slots, menus, pick }: { slots: AnswerSlot[]; menus: MenuSummary[]; pick: { guestId: string; eventId: string } }) {
  const [armed, setArmed] = useState(false);
  const id = flowId(pick);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a draft lives in sessionStorage, readable only after hydration
    if (readDraft(id)) setArmed(true);
  }, [id]);
  const s = slots.find((x) => x.guestId === pick.guestId && x.eventId === pick.eventId);
  if (!s) return null;
  if (armed) return <RecordAnswerFlow slots={slots} menus={menus} pick={pick} defaultOpen />;
  const name = `Correct ${s.displayName}’s answer for ${s.eventName}`;
  return (
    <button
      type="button"
      className="flow-trigger-quiet"
      aria-haspopup="dialog"
      aria-label={name}
      onClick={() => {
        // A correction closed half done keeps its draft closed; pressing Correct means "open it".
        const d = readDraft(id);
        if (d) writeDraft(id, { ...d, open: true });
        setArmed(true);
      }}
    >
      Correct
    </button>
  );
}
