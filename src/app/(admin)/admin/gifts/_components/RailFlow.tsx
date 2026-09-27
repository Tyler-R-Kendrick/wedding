'use client';

import { AdminFlow, type FieldErrors, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ChoiceField, GuestPreview, TextField } from '@/components/admin/flow/fields';
import { callCapability } from '@/components/handoff/client';

export interface RailOption {
  rail: 'zelle' | 'venmo' | 'paypal' | 'cashapp' | 'check';
  displayName: string;
  mode: 'link' | 'direct';
  personal: boolean;
  ask: { label: string; hint: string; multiline?: boolean };
  fee: string;
  /** Set when the couple already saved this way to give. */
  current: { handle: string; recipientName: string | null; active: boolean } | null;
}

interface Values extends Record<string, unknown> {
  rail: string;
  handle: string;
  recipientName: string;
  shown: boolean;
  url: string;
  instructions: string;
  tried: boolean;
}

interface CheckedRail {
  kind: 'rail';
  handle: string;
  url: string | null;
  instructions: string | null;
}

/**
 * Add or change a way to send a gift of money: choose the app, enter your own username or details,
 * then try the exact link guests will be given.
 *
 * The third step exists because a typo here sends a guest's money to a stranger. The site builds the
 * Venmo, PayPal or Cash App link from the handle; opening it is the only check that it is the
 * couple's own profile. Saving asks the admin to confirm it is them (`stepUp`), and the flow keeps
 * everything typed across that trip.
 */
export function RailFlow({ options, editing, label, variant = 'primary' }: { options: RailOption[]; editing?: RailOption['rail']; label: string; variant?: 'primary' | 'ghost' | 'quiet' }) {
  const fixed = editing ? options.find((o) => o.rail === editing) : undefined;
  const initial: Values = {
    rail: fixed?.rail ?? '',
    handle: fixed?.current?.handle ?? '',
    recipientName: fixed?.current?.recipientName ?? '',
    shown: fixed?.current?.active ?? true,
    url: '',
    instructions: '',
    tried: false,
  };
  const spec = (rail: string) => options.find((o) => o.rail === rail);

  const choose: FlowStep<Values> = {
    title: 'Choose how',
    lede: 'Guests send money from their own account straight to yours. This site never touches it and never takes a fee.',
    fields: ['rail'],
    render: (ctx) => (
      <ChoiceField
        ctx={ctx}
        name="rail"
        legend="Way to give"
        choices={options.map((o) => ({
          value: o.rail,
          label: o.displayName,
          badge: o.current ? (o.current.active ? 'set up' : 'set up, hidden') : undefined,
          description:
            o.mode === 'link'
              ? 'Guests tap a button that opens your profile in the app.'
              : o.rail === 'zelle'
                ? 'Guests send from their own bank. Shown only to guests who opened the site from their invitation.'
                : 'Guests mail a check. Your address is shown only to guests who opened the site from their invitation.',
        }))}
      />
    ),
    ready: (v) => Boolean(v.rail),
    readyHint: { field: 'rail', message: 'Choose one way to give.' },
    next: async (v) => {
      // Choosing one that is already set up edits it, starting from what is saved.
      const o = spec(v.rail);
      if (o?.current && !v.handle) return { patch: { handle: o.current.handle, recipientName: o.current.recipientName ?? '', shown: o.current.active } };
    },
  };

  const details: FlowStep<Values> = {
    title: 'Your details',
    fields: ['handle', 'recipientName', 'shown'],
    render: (ctx) => {
      const o = spec(ctx.values.rail);
      if (!o) return null;
      return (
        <>
          <TextField ctx={ctx} name="handle" label={o.ask.label} hint={o.ask.hint} multiline={o.ask.multiline} spellCheck={false} />
          <TextField
            ctx={ctx}
            name="recipientName"
            label={o.rail === 'check' ? 'Who checks are made out to' : 'Your name as the app shows it'}
            optional={o.rail !== 'check'}
            hint={o.rail === 'check' ? 'Exactly as your bank expects it on a check.' : 'Guests are told to look for this name before they send, so they know it is you.'}
          />
          <CheckField ctx={ctx} name="shown" label="Show this to guests" hint="Untick to keep it saved but hidden." />
        </>
      );
    },
    ready: (v) => v.handle.trim().length > 0,
    readyHint: { field: 'handle', message: 'Enter your details first.' },
    next: async (v) => {
      const o = spec(v.rail);
      const errors: FieldErrors = {};
      if (o?.rail === 'check' && !v.recipientName.trim()) errors.recipientName = 'Enter the name checks should be made out to.';
      const res = await callCapability<CheckedRail>('admin_check_gift_setup', { input: { kind: 'rail', rail: v.rail, handle: v.handle, recipientName: v.recipientName.trim() || undefined } });
      if (!res.ok || !res.data) errors.handle = res.error?.message ?? 'We could not check that. Please try again.';
      if (Object.keys(errors).length) return { errors };
      const d = res.data!;
      return { patch: { handle: d.handle, url: d.url ?? '', instructions: d.instructions ?? '', tried: d.url === v.url ? v.tried : false } };
    },
  };

  const tryIt: FlowStep<Values> = {
    title: 'Try it',
    fields: ['tried'],
    render: (ctx) => {
      const o = spec(ctx.values.rail);
      if (!o) return null;
      if (o.mode === 'link') {
        return (
          <>
            <p className="gs-step-copy">
              This is the link guests get. Open it: it should show <strong>your</strong> {o.displayName} profile. You do not need to send anything.
            </p>
            <div className="gs-found">
              <p className="gs-found__url">{ctx.values.url}</p>
              <p>
                <a className="ops-button ops-button-ghost gs-inline-button" href={ctx.values.url} target="_blank" rel="noopener noreferrer">
                  Open your {o.displayName} link<span aria-hidden="true"> ↗</span>
                </a>
              </p>
            </div>
            <CheckField ctx={ctx} name="tried" label={`It opened our own ${o.displayName} profile.`} />
            <p className="flow-hint">{o.fee}</p>
          </>
        );
      }
      return (
        <>
          <GuestPreview label="What invited guests will read">
            <p className="gs-preview-lines">{ctx.values.instructions}</p>
          </GuestPreview>
          <CheckField ctx={ctx} name="tried" label="That is right." />
          <p className="flow-hint">{o.fee}</p>
        </>
      );
    },
    ready: (v) => v.tried,
    readyHint: { field: 'tried', message: 'Open it and tick the box once it shows your own details. A typo here sends a guest’s gift to a stranger.' },
  };

  const steps = fixed ? [details, tryIt] : [choose, details, tryIt];

  return (
    <AdminFlow<Values>
      id={`gifts:rail:${editing ?? 'new'}`}
      title={fixed ? `Change ${fixed.displayName}` : 'Add a way to give'}
      trigger={{ label, variant }}
      initial={initial}
      steps={steps}
      submit={{
        label: 'Save',
        capability: 'admin_upsert_gift_rail',
        success: 'Saved. The Gifts page uses it now.',
        input: (v) => ({ rail: v.rail, handle: v.handle, recipientName: v.recipientName.trim() || undefined, active: v.shown }),
      }}
    />
  );
}
