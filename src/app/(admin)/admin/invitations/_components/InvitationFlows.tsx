'use client';

import { useState } from 'react';
import { AdminFlow, type FieldErrors, type FlowContext, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { formatDay } from '@/components/admin/flow/dates';

type Option = { value: string; label: string };

/** A link as a row shows it. Never the token: only its first characters, which identify it. */
export interface InvitationSummary {
  id: string;
  householdName: string;
  tokenPrefix: string;
}

interface Issued {
  url: string;
  qrSvg: string;
  invitation: { expiresAt: string };
}


/**
 * The one place an invitation link is ever shown: the Done panel of the flow that made it. The token
 * is not stored (only a hash), so once this closes the link cannot be shown again, only replaced.
 */
function OneTimeLink({ issued, householdName }: { issued: Issued; householdName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied('Copied.');
    } catch {
      setCopied('Copying did not work here: select the link and copy it.');
    }
  };
  return (
    <div className="flow-found" data-testid="issued-link">
      <p>
        <strong>{householdName}’s link, shown only this once.</strong> Copy it or save the QR code before you close this: it cannot be shown again, only replaced.
      </p>
      <p className="flow-found__url">{issued.url}</p>
      <p>
        <button type="button" className="ops-button ops-button-ghost flow-inline-button" onClick={copy}>
          Copy the link
        </button>{' '}
        <span role="status">{copied}</span>
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URI; there is nothing to optimise */}
      <img className="ops-qr" alt={`QR code for ${householdName}’s invitation link`} src={`data:image/svg+xml;utf8,${encodeURIComponent(issued.qrSvg)}`} />
      <p className="flow-hint">It works until {formatDay(issued.invitation.expiresAt)}.</p>
    </div>
  );
}

/**
 * The events a link invites the household to, as boxes to tick. The kit's `CheckField` is one box;
 * this is a group of them, in the kit's choice-row styling.
 */
function EventsField({ ctx, events }: { ctx: FlowContext<IssueValues>; events: Option[] }) {
  const chosen = ctx.values.eventKeys;
  const error = ctx.errors.eventKeys;
  const toggle = (key: string, on: boolean) => ctx.set({ eventKeys: on ? [...chosen, key] : chosen.filter((k) => k !== key) });
  return (
    <fieldset className="flow-choices" aria-describedby={error ? `${ctx.uid}-eventKeys-error` : `${ctx.uid}-eventKeys-hint`}>
      <legend className="flow-label">Events</legend>
      <p id={`${ctx.uid}-eventKeys-hint`} className="flow-hint">
        What the invitation says they are invited to. Each guest’s own events can be changed later on the Events screen.
      </p>
      <div className="flow-choices__list">
        {events.map((e, i) => {
          const id = i === 0 ? `${ctx.uid}-eventKeys` : `${ctx.uid}-eventKeys-${e.value}`;
          return (
            <label key={e.value} htmlFor={id} className="flow-choice">
              <input id={id} type="checkbox" checked={chosen.includes(e.value)} onChange={(ev) => toggle(e.value, ev.target.checked)} />
              <span className="flow-choice__text">
                <span className="flow-choice__label">{e.label}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error ? (
        <p id={`${ctx.uid}-eventKeys-error`} className="flow-field-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

interface IssueValues extends Record<string, unknown> {
  householdId: string;
  eventKeys: string[];
  /** Used only when the events could not be listed: the keys typed in, separated by semicolons. */
  eventText: string;
  plusOneAllowance: string;
  childrenAllowance: string;
}

const whole = (s: string, max: number) => /^\d+$/.test(s.trim()) && Number(s) <= max;

/**
 * Make an invitation link for a household: who, what it invites them to, then the link itself, once.
 *
 * `events` is null when this admin cannot list the events (it needs content access as well as guest
 * access); the step then asks for the event keys as text, as the old form always did.
 */
export function IssueLinkFlow({ households, events, defaultEvents }: { households: Option[]; events: Option[] | null; defaultEvents: string[] }) {
  const householdName = (id: string) => households.find((h) => h.value === id)?.label ?? 'The household';
  const keysOf = (v: IssueValues) => (events ? v.eventKeys : v.eventText.split(/[;,]/).map((s) => s.trim()).filter(Boolean));
  const eventName = (k: string) => events?.find((e) => e.value === k)?.label ?? k;

  const steps: FlowStep<IssueValues>[] = [
    {
      title: 'Which household',
      fields: ['householdId'],
      render: (ctx) => (
        <SelectField
          ctx={ctx}
          name="householdId"
          label="Household"
          options={households}
          placeholder={households.length ? 'Choose a household' : 'Add a household first'}
          hint="Everyone in the household uses the same link to find their invitation."
        />
      ),
      ready: (v) => Boolean(v.householdId),
      readyHint: { field: 'householdId', message: 'Choose the household.' },
    },
    {
      title: 'What it invites them to',
      fields: ['eventKeys', 'eventText', 'plusOneAllowance', 'childrenAllowance'],
      render: (ctx) => (
        <>
          {events ? (
            <EventsField ctx={ctx} events={events} />
          ) : (
            <TextField ctx={ctx} name="eventText" label="Events" spellCheck={false} hint="The event keys, separated by semicolons: “ceremony; reception”." />
          )}
          <TextField ctx={ctx} name="plusOneAllowance" label="Plus-ones they may bring" type="number" min={0} max={10} hint="0 to 10." />
          <TextField ctx={ctx} name="childrenAllowance" label="Children they may bring" type="number" min={0} max={20} hint="Children not already on the guest list. 0 to 20." />
        </>
      ),
      ready: (v) => keysOf(v).length > 0,
      readyHint: { field: events ? 'eventKeys' : 'eventText', message: 'Choose at least one event.' },
      next: async (v) => {
        const errors: FieldErrors = {};
        if (!whole(v.plusOneAllowance, 10)) errors.plusOneAllowance = 'Enter a whole number from 0 to 10.';
        if (!whole(v.childrenAllowance, 20)) errors.childrenAllowance = 'Enter a whole number from 0 to 20.';
        return { errors };
      },
    },
    {
      title: 'Check and make the link',
      lede: 'The link is shown once, on the next screen. Have somewhere ready to paste it.',
      render: (ctx) => (
        <ReviewList
          items={[
            { label: 'Household', value: householdName(ctx.values.householdId) },
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
      id="invitations:issue"
      title="Make an invitation link"
      trigger={{ label: 'Make a link' }}
      initial={{ householdId: '', eventKeys: defaultEvents, eventText: defaultEvents.join('; '), plusOneAllowance: '0', childrenAllowance: '0' }}
      steps={steps}
      submit={{
        label: (v) => {
          const chosen = households.find((h) => h.value === v.householdId);
          return chosen ? `Make ${chosen.label}’s link` : 'Make the link';
        },
        capability: 'admin_issue_invitation',
        success: 'Invitation link made.',
        input: (v) => ({ householdId: v.householdId, eventKeys: keysOf(v), plusOneAllowance: Number(v.plusOneAllowance), childrenAllowance: Number(v.childrenAllowance) }),
        result: (data, v) => <OneTimeLink issued={data as Issued} householdName={householdName(v.householdId)} />,
      }}
    />
  );
}

/** Replaces a link that leaked or was lost: the old one stops working and a new one is shown, once. */
export function RotateLinkFlow({ invitation }: { invitation: InvitationSummary }) {
  const who = invitation.householdName;
  return (
    <AdminFlow<{ confirmed: boolean }>
      id={`invitations:rotate:${invitation.id}`}
      tone="danger"
      title={`Replace ${who}’s link`}
      trigger={{ label: 'Replace', variant: 'quiet', accessibleName: `Replace ${who}’s invitation link` }}
      initial={{ confirmed: false }}
      steps={[
        {
          title: `Replace ${who}’s link?`,
          fields: ['confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  The link starting <span className="ops-code">{invitation.tokenPrefix}</span> stops working at once, for everyone in {who} who still has it.
                </p>
                <p>A new link is made for the same events and allowances. It is shown once, on the next screen: send it to them again.</p>
              </Consequences>
              <CheckField ctx={ctx} name="confirmed" label="Yes, replace the link (the old one stops working)" />
            </>
          ),
          ready: (v) => v.confirmed,
          readyHint: { field: 'confirmed', message: 'Tick the box to confirm.' },
        },
      ]}
      submit={{
        label: `Replace ${who}’s link`,
        capability: 'admin_rotate_invitation',
        success: 'Link replaced.',
        input: () => ({ invitationId: invitation.id }),
        result: (data) => <OneTimeLink issued={data as Issued} householdName={who} />,
      }}
    />
  );
}

/** Stops a link for good without making a new one: it went to the wrong person, or they are no longer invited. */
export function RevokeLinkFlow({ invitation }: { invitation: InvitationSummary }) {
  const who = invitation.householdName;
  return (
    <AdminFlow<{ confirmed: boolean; reason: string }>
      id={`invitations:revoke:${invitation.id}`}
      tone="danger"
      title={`Revoke ${who}’s link`}
      trigger={{ label: 'Revoke', variant: 'danger', accessibleName: `Revoke ${who}’s invitation link` }}
      initial={{ confirmed: false, reason: '' }}
      steps={[
        {
          title: `Revoke ${who}’s link?`,
          fields: ['reason', 'confirmed'],
          render: (ctx) => (
            <>
              <Consequences>
                <p>
                  The link starting <span className="ops-code">{invitation.tokenPrefix}</span> stops working at once. No new link is made: if {who} should still be able to find their invitation, make them one.
                </p>
                <p>Guests who have already signed in keep their access. This cannot be undone.</p>
              </Consequences>
              <TextField ctx={ctx} name="reason" label="Why" hint="Kept in the audit trail. For example: “sent to the wrong address”." />
              <CheckField ctx={ctx} name="confirmed" label={`Yes, revoke ${who}’s link`} />
            </>
          ),
          ready: (v) => v.confirmed && v.reason.trim().length > 0,
          readyHint: { field: 'confirmed', message: 'Say why, and tick the box to confirm.' },
        },
      ]}
      submit={{ label: `Revoke ${who}’s link`, capability: 'admin_revoke_invitation', success: `${who}’s link revoked.`, input: (v) => ({ invitationId: invitation.id, reason: v.reason.trim().slice(0, 200) }) }}
    />
  );
}
