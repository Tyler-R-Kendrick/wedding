'use client';

import { useState } from 'react';
import { AdminFlow, type FieldErrors, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { Consequences, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';

export interface LifecycleMove {
  to: string;
  direction: string;
}

interface PublishValues extends Record<string, unknown> {
  to: string;
  note: string;
  /** Filled by step 1's draft call; never typed. */
  from: string;
  consequences: string[];
  token: string;
  expiresAt: string;
}

interface DraftData {
  from: string;
  publish: { to: string; note?: string };
  consequences: string[];
}

/** The note exactly as both calls send it: the token is bound to this payload, key for key. */
const payload = (v: PublishValues) => ({ to: v.to, note: v.note.trim() || undefined });

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * Publishing a lifecycle state: choose it, then read back what it changes before publishing.
 *
 * Step 1's Continue calls `draft_lifecycle_transition`, which has no side effects and issues a
 * single-use confirmation token bound to this exact state and note. Step 2 shows the consequences
 * the server wrote, and the publish presents that token. Going Back and continuing again drafts
 * again, so a changed note is never published under a token issued for the old one.
 *
 * Not durable: the token expires within minutes, so a draft kept on the device would come back
 * holding a dead one. A closed sheet starts over.
 */
export function PublishFlow({ moves }: { moves: LifecycleMove[] }) {
  // The kit's submit label is a string, not a function of the values, and the button has to name
  // the state it publishes. Step 1's `next` is the one place the choice is settled, so it records it.
  const [chosen, setChosen] = useState(moves[0]?.to ?? '');

  const steps: FlowStep<PublishValues>[] = [
    {
      title: 'Choose the state',
      lede: 'Reviewing is free and changes nothing. You will see what the move does before anything is published.',
      fields: ['to', 'note'],
      render: (ctx) => (
        <>
          <SelectField ctx={ctx} name="to" label="Move the site to" options={moves.map((m) => ({ value: m.to, label: `${m.to} (${m.direction})` }))} />
          <TextField ctx={ctx} name="note" label="Why" optional hint="Admin-only. Kept with the published state and in the audit trail." />
        </>
      ),
      ready: (v) => Boolean(v.to),
      readyHint: { field: 'to', message: 'Choose the state to move the site to.' },
      next: async (v): Promise<{ errors?: FieldErrors; patch?: Partial<PublishValues> }> => {
        if (v.note.trim().length > 500) return { errors: { note: 'Keep this under 500 characters.' } };
        const res = await callCapability<DraftData>('draft_lifecycle_transition', { input: payload(v) });
        if (!res.ok || !res.data) return { errors: { to: res.error?.message ?? 'That change could not be reviewed. Please try again.' } };
        if (!res.confirmation?.token) return { errors: { to: 'No confirmation was issued for this change. Please try again.' } };
        setChosen(res.data.publish.to);
        return { patch: { from: res.data.from, consequences: res.data.consequences, token: res.confirmation.token, expiresAt: res.confirmation.expiresAt } };
      },
    },
    {
      title: 'Check and publish',
      lede: 'Nothing has been published yet.',
      render: ({ values: v }) => (
        <>
          <ReviewList
            items={[
              { label: 'From', value: v.from },
              { label: 'To', value: v.to },
              { label: 'Why', value: v.note.trim() },
            ]}
          />
          <Consequences>
            <p>What publishing does:</p>
            <ul>
              {v.consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Consequences>
          <p className="flow-hint">
            This confirmation expires at <time dateTime={v.expiresAt}>{clock(v.expiresAt)}</time>. Going back and continuing again issues a new one.
          </p>
        </>
      ),
    },
  ];

  return (
    <AdminFlow<PublishValues>
      id="lifecycle:publish"
      title="Publish a new state"
      trigger={{ label: 'Publish a new state' }}
      durable={false}
      initial={{ to: moves[0]?.to ?? '', note: '', from: '', consequences: [], token: '', expiresAt: '' }}
      steps={steps}
      submit={{
        label: `Publish ${chosen} to every guest`,
        capability: 'admin_publish_lifecycle',
        input: payload,
        confirmationToken: (v) => v.token || undefined,
        success: `Published ${chosen}. Guests see it on their next page load.`,
      }}
    />
  );
}
