'use client';

import { AdminFlow } from '@/components/admin/flow/AdminFlow';
import { Consequences, ReviewList, TextField } from '@/components/admin/flow/fields';
import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import { chicagoLocalToIso, formatDeadline, formatEventDate, isoToChicagoLocal } from '@/domain/events/format';
import { withValue, type DetailEdit, type ShownOn } from '@/domain/site-details';

type Values = { value: string };
type Here = Extract<DetailEdit, { kind: 'here' }>;

const TYPE = { date: 'date', datetime: 'datetime-local', text: 'text', url: 'url' } as const;

/**
 * Change one shared fact, in one step and a check. The check says, in the fact's own words, every
 * page that will read the new value, and names any copy in the code that will not: the person
 * saving sees the reach of the change before it lands.
 */
export function DetailFlow({ id, label, now, edit, shownOn, copies }: { id: string; label: string; now: string | null; edit: Here; shownOn: ShownOn[]; copies: { where: string; value: string }[] }) {
  const initial = edit.input === 'datetime' ? isoToChicagoLocal(edit.raw) : edit.raw;
  const toSaved = (v: string): string | null => {
    const text = v.trim();
    if (!text) return null;
    return edit.input === 'datetime' ? chicagoLocalToIso(text) : text;
  };
  /** The new value as the site will print it, so "Now" and "Becomes" read alike. */
  const shown = (v: string) => {
    const text = v.trim();
    if (!text) return 'Not decided';
    if (edit.input === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? formatEventDate(text, WEDDING_TIMEZONE) : text;
    if (edit.input === 'datetime') return formatDeadline(chicagoLocalToIso(text) ?? '', WEDDING_TIMEZONE) || text;
    return text;
  };
  /** What the server will accept, checked here so the check step never shows a value that cannot be saved. */
  const valid = (v: string) => {
    const text = v.trim();
    if (!text) return edit.optional;
    if (edit.input === 'url') return URL.canParse(text) && text.startsWith('https://');
    if (edit.input === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text);
    if (edit.input === 'datetime') return chicagoLocalToIso(text) !== null;
    return true;
  };
  return (
    <AdminFlow<Values>
      id={`details:${id}`}
      title={`Edit ${label.toLowerCase()}`}
      trigger={{ label: now ? 'Edit' : 'Set', variant: 'quiet', accessibleName: `${now ? 'Edit' : 'Set'} ${label.toLowerCase()}` }}
      initial={{ value: initial }}
      steps={[
        {
          // Not the fact's own name: the field below carries that, and a step and a field with one
          // name read as the same thing twice.
          title: 'What it should say',
          fields: ['value'],
          render: (ctx) => (
            <TextField
              ctx={ctx}
              name="value"
              label={label}
              type={TYPE[edit.input]}
              optional={edit.optional}
              hint={edit.input === 'datetime' ? 'Chicago time.' : edit.input === 'url' ? 'An https address.' : edit.optional ? 'Leave it empty if it is not decided.' : undefined}
            />
          ),
          ready: (v) => valid(v.value),
          readyHint: { field: 'value', message: edit.input === 'url' ? 'Enter an address that starts with https://.' : `Enter the ${label.toLowerCase()}.` },
        },
        {
          title: 'Check and save',
          render: (ctx) => (
            <>
              <ReviewList
                items={[
                  { label: 'Now', value: now ?? 'Not decided' },
                  { label: 'Becomes', value: shown(ctx.values.value) },
                ]}
              />
              <Consequences tone="note">
                <p>Changes on: {shownOn.map((p) => p.label).join(', ')}.</p>
                {copies.length ? <p>Does not change: {copies.map((c) => c.where).join('; ')}. Those are set in the code.</p> : null}
              </Consequences>
            </>
          ),
        },
      ]}
      submit={{ label: `Save ${label.toLowerCase()}`, capability: edit.capability, input: (v) => withValue(edit.base, edit.field, toSaved(v.value)), success: `${label} saved.` }}
    />
  );
}
