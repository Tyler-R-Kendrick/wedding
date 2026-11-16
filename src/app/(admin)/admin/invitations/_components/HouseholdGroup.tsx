'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AdminFlow, type FieldErrors, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, CheckGroupField, Consequences, ReviewList, TextField } from '@/components/admin/flow/fields';
import { formatDay } from '@/components/admin/flow/dates';
import { Pill } from '@/components/admin/flow/records';
import { callCapability, newIdempotencyKey } from '@/components/handoff/client';

type Option = { value: string; label: string };

/** A household as the list shows it: where its invitation stands, and whether it is in the group. */
export interface HouseholdGroupRow {
  id: string;
  name: string;
  people: number;
  inGroup: boolean;
  link: 'none' | 'active' | 'claimed';
  sentAt: string | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const households = (n: number) => count(n, 'household', 'households');
/** Names as a sentence, however many: "Ada Lovelace, the Garden table and 3 more". */
const sentence = (names: readonly string[], most = 12) => {
  const shown = names.slice(0, most);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length <= 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
};

/**
 * The households, and the group of them the couple are working on.
 *
 * Ticking a household puts it in the group; unticking takes it out. The group is saved as it
 * changes (`admin_set_bulk_group`), so it is still there on the next visit and is the same group
 * for both of them. The bar above the list acts on the whole group, including households the
 * current search or filter is not showing: it says how many those are, and every action names the
 * households it is about to change before it changes them.
 *
 * Nothing here marks anything as sent on its own. Making links and marking as sent are separate
 * acts, each behind a step that says what it does; a household with no link is skipped by "Mark as
 * sent" and named, never given a link quietly.
 */
export function HouseholdGroup({ rows, shownIds, events, defaultEvents, filtered }: { rows: HouseholdGroupRow[]; shownIds: string[]; events: Option[] | null; defaultEvents: string[]; filtered: boolean }) {
  const saved = useMemo(() => rows.filter((r) => r.inGroup).map((r) => r.id), [rows]);
  const [group, setGroup] = useState<Set<string>>(() => new Set(saved));
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone?: 'error'; undo?: string[] } | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  // How much of the viewport the stuck bar covers, for the rows' scroll margin: a tick box reached
  // with Shift+Tab must come to rest below the bar, not under it. On a phone only the first line
  // sticks (flow.css), so it is that line's height there and the whole bar's from tablet up.
  useEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    const head = headRef.current;
    if (!root || !bar || !head || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const stuck = getComputedStyle(bar).position === 'sticky' ? bar : head;
      root.style.setProperty('--flow-bulk-stuck', `${Math.ceil(stuck.getBoundingClientRect().height)}px`);
    };
    const watch = new ResizeObserver(measure);
    watch.observe(bar);
    watch.observe(head);
    measure();
    return () => watch.disconnect();
  }, []);

  // What the server says is the group, whenever the page re-reads it (after an action): taken up
  // during render, the way React asks for state that follows a prop.
  const savedKey = saved.join('|');
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setGroup(new Set(saved));
  }

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const shown = shownIds.map((id) => byId.get(id)).filter((r): r is HouseholdGroupRow => Boolean(r));
  const inGroup = rows.filter((r) => group.has(r.id));
  const shownInGroup = shown.filter((r) => group.has(r.id)).length;
  const hidden = inGroup.length - shownInGroup;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = shownInGroup > 0 && shownInGroup < shown.length;
  }, [shownInGroup, shown.length]);

  /** Changes the group here at once, saves it, and puts it back as it was if the save does not land. */
  const put = async (ids: string[], on: boolean) => {
    if (!ids.length) return;
    const apply = (to: boolean) =>
      setGroup((g) => {
        const next = new Set(g);
        for (const id of ids) {
          if (to) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    apply(on);
    setNotice(null);
    setPending((n) => n + 1);
    const r = await callCapability<{ changed: number }>('admin_set_bulk_group', { input: { householdIds: ids, inGroup: on }, idempotencyKey: newIdempotencyKey() });
    setPending((n) => n - 1);
    if (!r.ok) {
      // Only these households go back: another tick may have been saved meanwhile.
      apply(!on);
      setNotice({ text: r.error?.message ?? 'The group could not be saved. Please try again.', tone: 'error' });
    }
  };

  const none = inGroup.length === 0;
  const hinted = none && shown.length > 0;
  const withoutLink = inGroup.filter((r) => r.link === 'none');
  const withLink = inGroup.filter((r) => r.link !== 'none');
  const notSent = withLink.filter((r) => !r.sentAt);
  const sent = withLink.filter((r) => r.sentAt);
  const ids = inGroup.map((r) => r.id);

  /** Takes everyone out. The group may have been gathered across several searches, so it can be put back. */
  const empty = async () => {
    const was = ids;
    await put(was, false);
    setNotice((n) => (n?.tone === 'error' ? n : { text: `The group is empty: ${households(was.length)} taken out.`, undo: was }));
    // The button that was pressed is gone with the group: focus goes somewhere that still exists.
    requestAnimationFrame(() => allRef.current?.focus());
  };

  return (
    <div ref={rootRef} className="flow-bulk" data-testid="household-group">
      <div ref={barRef} className="flow-bulk__bar">
        <div ref={headRef} className="flow-bulk__head">
          <label className="flow-bulk__all">
            <input
              ref={allRef}
              type="checkbox"
              checked={shown.length > 0 && shownInGroup === shown.length}
              disabled={shown.length === 0}
              onChange={(e) => void put(e.target.checked ? shown.filter((r) => !group.has(r.id)).map((r) => r.id) : shown.filter((r) => group.has(r.id)).map((r) => r.id), e.target.checked)}
            />
            <span>{filtered ? 'All shown' : 'All households'}</span>
          </label>
          <span className="flow-bulk__count" data-testid="group-count">
            <span aria-live="polite">
              {none ? 'Nobody in the group' : `${households(inGroup.length)} in the group`}
              {hidden > 0 ? ` (${hidden} not shown here)` : ''}
            </span>
            {/* Outside the live region: a tick is announced once, by the count, not twice. */}
            {pending > 0 ? <span aria-hidden="true"> · saving…</span> : null}
          </span>
        </div>
        <div className="flow-bulk__actions" role="group" aria-label="What to do with the group">
          {none ? (
            <>
              {['Make links', 'Mark as sent', 'Mark as not sent'].map((label) => (
                <button key={label} type="button" className="ops-button ops-button-ghost" aria-disabled="true" aria-describedby={hinted ? hintId : undefined}>
                  {label}
                </button>
              ))}
            </>
          ) : (
            <>
              <MakeLinksFlow group={inGroup} withoutLink={withoutLink} events={events} defaultEvents={defaultEvents} />
              <MarkSentFlow ids={ids} sent toChange={notSent} already={sent.length} noLink={withoutLink} />
              <MarkSentFlow ids={ids} sent={false} toChange={sent} already={notSent.length} noLink={withoutLink} />
              <button type="button" className="ops-button ops-button-ghost" onClick={() => void empty()}>
                Empty the group
              </button>
            </>
          )}
        </div>
      </div>
      {hinted ? (
        <p id={hintId} className="flow-bulk__hint">
          Tick households to put them in the group. The group is saved as you go.
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="flow-bulk__note" data-tone={notice.tone}>
          {notice.text}
          {notice.undo ? (
            <>
              {' '}
              <button
                type="button"
                className="ops-button ops-button-ghost flow-inline-button"
                onClick={() => {
                  const back = notice.undo!;
                  setNotice(null);
                  void put(back, true);
                }}
              >
                Put them back
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="flow-empty" role="status">
          {rows.length === 0 ? 'No household is on the guest list yet.' : 'No household matches this search.'}
        </p>
      ) : (
        <ul className="flow-rows" role="list" aria-label="Households">
          {shown.map((r) => (
            <li key={r.id} className="flow-row flow-bulk__row" data-household-id={r.id} data-selected={group.has(r.id) ? '' : undefined}>
              <label className="flow-bulk__pick">
                <input type="checkbox" checked={group.has(r.id)} onChange={(e) => void put([r.id], e.target.checked)} />
                <span className="sr-only">In the group: {r.name}</span>
              </label>
              <div className="flow-row__main">
                <p className="flow-row__title">
                  {r.name}{' '}
                  {r.link === 'none' ? <Pill>No link</Pill> : <Pill tone="good">{r.link === 'claimed' ? 'Link opened and claimed' : 'Link made'}</Pill>}{' '}
                  {r.link === 'none' ? null : r.sentAt ? <Pill tone="good">Sent {formatDay(r.sentAt)}</Pill> : <Pill tone="warn">Not sent</Pill>}
                </p>
                <p className="flow-row__meta">{r.people === 0 ? 'Nobody named' : count(r.people, 'person', 'people')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface IssueValues extends Record<string, unknown> {
  eventKeys: string[];
  eventText: string;
  plusOneAllowance: string;
  childrenAllowance: string;
}
interface IssuedLinks {
  links: { householdId: string; householdName: string; url: string; tokenPrefix: string; expiresAt: string }[];
  hadLink: number;
}
const whole = (s: string, max: number) => /^\d+$/.test(s.trim()) && Number(s) <= max;

/** The links a bulk make shows: once, here, with a copy of all of them for a mail merge. Never stored. */
function OneTimeLinks({ issued }: { issued: IssuedLinks }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(['Household\tLink', ...issued.links.map((l) => `${l.householdName}\t${l.url}`)].join('\n'));
      setCopied('Copied. Paste it into a sheet: one household and its link per row.');
    } catch {
      setCopied('Copying did not work here: select the links and copy them.');
    }
  };
  if (issued.links.length === 0) {
    return (
      <div className="flow-found" data-testid="issued-links">
        <p>No link was made: every household in the group already has one.</p>
      </div>
    );
  }
  return (
    <div className="flow-found" data-testid="issued-links">
      <p>
        <strong>{count(issued.links.length, 'link', 'links')}, shown only this once.</strong> Copy them before you close this: they cannot be shown again, only replaced. None is marked as sent.
      </p>
      <p>
        <button type="button" className="ops-button ops-button-ghost flow-inline-button" onClick={copy}>
          Copy all the links
        </button>{' '}
        <span role="status">{copied}</span>
      </p>
      <ul className="flow-bulk__links" aria-label="The new links">
        {issued.links.map((l) => (
          <li key={l.householdId}>
            <span>{l.householdName}</span>
            <span className="flow-found__url">{l.url}</span>
          </li>
        ))}
      </ul>
      <p className="flow-hint">
        They work until {formatDay(issued.links[0]!.expiresAt)}.{issued.hadLink > 0 ? ` ${households(issued.hadLink)} already had a link and ${issued.hadLink === 1 ? 'was' : 'were'} left alone.` : ''}
      </p>
    </div>
  );
}

/** Makes a link for every household in the group that has none. The ones that have one are left alone. */
function MakeLinksFlow({ group, withoutLink, events, defaultEvents }: { group: HouseholdGroupRow[]; withoutLink: HouseholdGroupRow[]; events: Option[] | null; defaultEvents: string[] }) {
  const keysOf = (v: IssueValues) => (events ? v.eventKeys : v.eventText.split(/[;,]/).map((s) => s.trim()).filter(Boolean));
  const eventName = (k: string) => events?.find((e) => e.value === k)?.label ?? k;
  const have = group.length - withoutLink.length;
  const steps: FlowStep<IssueValues>[] = [
    {
      title: 'What they invite them to',
      lede: `The same for every link made here. ${households(withoutLink.length)} in the group ${withoutLink.length === 1 ? 'has' : 'have'} no link yet.`,
      fields: ['eventKeys', 'eventText', 'plusOneAllowance', 'childrenAllowance'],
      render: (ctx) => (
        <>
          {events ? (
            <CheckGroupField ctx={ctx} name="eventKeys" legend="Events" choices={events} hint="What each invitation says they are invited to. A guest’s own events can be changed later on the Events screen." />
          ) : (
            <TextField ctx={ctx} name="eventText" label="Events" spellCheck={false} hint="The event keys, separated by semicolons: “ceremony; reception”." />
          )}
          <TextField ctx={ctx} name="plusOneAllowance" label="Plus-ones each may bring" type="number" min={0} max={10} hint="0 to 10. Change one household’s later by replacing its link." />
          <TextField ctx={ctx} name="childrenAllowance" label="Children each may bring" type="number" min={0} max={20} hint="Children not already on the guest list. 0 to 20." />
        </>
      ),
      ready: (v) => withoutLink.length > 0 && keysOf(v).length > 0,
      readyHint: withoutLink.length === 0 ? { message: 'Every household in the group already has a link.' } : { field: events ? 'eventKeys' : 'eventText', message: 'Choose at least one event.' },
      next: async (v) => {
        const errors: FieldErrors = {};
        if (!whole(v.plusOneAllowance, 10)) errors.plusOneAllowance = 'Enter a whole number from 0 to 10.';
        if (!whole(v.childrenAllowance, 20)) errors.childrenAllowance = 'Enter a whole number from 0 to 20.';
        return { errors };
      },
    },
    {
      title: 'Check and make the links',
      lede: 'The links are shown once, on the next screen. Have somewhere ready to paste them. Making a link does not mark it as sent.',
      render: (ctx) => (
        <ReviewList
          items={[
            { label: withoutLink.length ? `A link for ${households(withoutLink.length)}` : 'A link for', value: withoutLink.length ? <p className="flow-bulk__names">{sentence(withoutLink.map((r) => r.name), 200)}</p> : 'Nobody: every household in the group has one' },
            ...(have > 0 ? [{ label: 'Left alone', value: `${households(have)} that already ${have === 1 ? 'has' : 'have'} a link` }] : []),
            { label: 'Events', value: keysOf(ctx.values).map(eventName).join(', ') },
            { label: 'Plus-ones', value: ctx.values.plusOneAllowance },
            { label: 'Children', value: ctx.values.childrenAllowance },
          ]}
        />
      ),
    },
  ];
  return (
    <AdminFlow<IssueValues>
      id="invitations:group:issue"
      durable={false}
      title="Make links for the group"
      trigger={{ label: 'Make links', variant: 'ghost', accessibleName: `Make links for the ${households(group.length)} in the group` }}
      initial={{ eventKeys: defaultEvents, eventText: defaultEvents.join('; '), plusOneAllowance: '0', childrenAllowance: '0' }}
      steps={steps}
      submit={{
        label: withoutLink.length ? `Make ${count(withoutLink.length, 'link', 'links')}` : 'Make links',
        capability: 'admin_issue_invitations',
        success: 'Links made.',
        input: (v) => ({ householdIds: withoutLink.map((r) => r.id), eventKeys: keysOf(v), plusOneAllowance: Number(v.plusOneAllowance), childrenAllowance: Number(v.childrenAllowance) }),
        result: (data) => <OneTimeLinks issued={data as IssuedLinks} />,
      }}
    />
  );
}

interface MarkResult {
  sent: boolean;
  changed: number;
  already: number;
  noLink: string[];
}

/** What a bulk mark did, in the words the sheet asked in. */
function MarkOutcome({ data }: { data: unknown }) {
  const r = data as MarkResult;
  return (
    <div className="flow-found" data-testid="mark-result">
      <p>
        <strong>
          {households(r.changed)} marked as {r.sent ? 'sent' : 'not sent'}.
        </strong>
        {r.already > 0 ? ` ${households(r.already)} ${r.already === 1 ? 'was' : 'were'} already so.` : ''}
      </p>
      {r.noLink.length > 0 ? <p>Skipped, with no link yet: {sentence(r.noLink, 200)}.</p> : null}
    </div>
  );
}

/**
 * Marks the group as sent, or as not sent. One step that says which households change, which are
 * already so, and which have no link and will be skipped; then what happened, in the same words.
 *
 * Marking as not sent takes sign-in by name away from those households, so it is a `danger` flow
 * like the console's other withdrawals: what happens, a box that confirms it, a red button.
 */
function MarkSentFlow({ ids, sent, toChange, already, noLink }: { ids: string[]; sent: boolean; toChange: HouseholdGroupRow[]; already: number; noLink: HouseholdGroupRow[] }) {
  const label = sent ? 'Mark as sent' : 'Mark as not sent';
  const n = toChange.length;
  const nobody = sent ? (noLink.length ? 'Nobody in the group has a link that is not already sent. Make links first.' : 'Everybody in the group is already marked as sent.') : 'Nobody in the group is marked as sent.';
  const review = (
    <ReviewList
      items={[
        { label: sent ? 'Marked as sent' : 'Marked as not sent', value: n ? <p className="flow-bulk__names">{sentence(toChange.map((r) => r.name), 200)}</p> : 'Nobody' },
        ...(already > 0 ? [{ label: sent ? 'Already sent' : 'Already not sent', value: households(already) }] : []),
        // Only when marking as sent: a household with no link has nothing to be marked as not sent.
        ...(sent && noLink.length > 0 ? [{ label: 'Skipped: no link yet', value: <p className="flow-bulk__names">{sentence(noLink.map((r) => r.name), 200)}. Make their links first.</p> }] : []),
      ]}
    />
  );
  const submit = {
    label: n ? `Mark ${households(n)} as ${sent ? 'sent' : 'not sent'}` : label,
    capability: 'admin_mark_households_sent',
    success: sent ? 'Marked as sent.' : 'Marked as not sent.',
    input: () => ({ householdIds: ids, sent }),
    result: (data: unknown) => <MarkOutcome data={data} />,
  };
  const trigger = { label, accessibleName: `${label}: the ${households(ids.length)} in the group` };
  if (sent) {
    return (
      <AdminFlow<{ ok: boolean }>
        id="invitations:group:sent"
        durable={false}
        title="Mark the group as sent"
        trigger={{ ...trigger, variant: 'ghost' }}
        initial={{ ok: true }}
        steps={[
          {
            title: n ? `Mark ${households(n)} as sent?` : 'Nobody to mark as sent',
            lede: 'Do this once their save-the-date or invitation has gone out. From then on, the guests in these households can sign in with Google or Facebook under the name on the guest list.',
            render: () => review,
            ready: () => n > 0,
            readyHint: { message: nobody },
          },
        ]}
        submit={submit}
      />
    );
  }
  return (
    <AdminFlow<{ confirmed: boolean }>
      id="invitations:group:not-sent"
      tone="danger"
      title="Mark the group as not sent"
      trigger={{ ...trigger, variant: 'danger' }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: n ? `Mark ${households(n)} as not sent?` : 'Nobody to mark as not sent',
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              {n ? (
                <Consequences>
                  <p>The guests in these households can no longer sign in with Google or Facebook by name, until the household is marked as sent again.</p>
                  <p>Guests who have already signed in keep their access. It can be undone: mark them as sent again.</p>
                </Consequences>
              ) : null}
              {review}
              {n ? <CheckField ctx={ctx} name="confirmed" label={`Yes, mark ${households(n)} as not sent`} /> : null}
            </>
          ),
          ready: (v) => n > 0 && v.confirmed,
          readyHint: n ? { field: 'confirmed', message: 'Tick the box to confirm.' } : { message: nobody },
        },
      ]}
      submit={submit}
    />
  );
}
