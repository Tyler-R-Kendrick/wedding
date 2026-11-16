'use client';

import { action, defineComponent, reactive, useFormName, useStateField, useTriggerAction } from '@openuidev/react-lang';
import NextLink from 'next/link';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { z } from 'zod/v4';
import { AdminIcon, isAdminIcon } from '@/components/admin/shell/icons';
import { Chart as ChartView, type ChartProps } from '@/components/admin/viz/Chart';
import { useAssistantHost } from './host';

/**
 * What an assistant answer in the console may be built from: the dashboard part of the Intelligent
 * UI vocabulary (open-intelligent-ui, thesysdev, MIT — ./functions/LICENSE-open-intelligent-ui.txt),
 * with the same names and positional arguments, drawn with this console's tokens (../assistant.css).
 * `Proposal` is the one addition: a change to the site that a person reviews and confirms.
 *
 * Only what the composer (src/domain/admin-assistant/compose.ts) writes is here. A program may ask
 * for a colour or a size by name; it can never bring its own CSS.
 */

type Plan = Parameters<ReturnType<typeof useTriggerAction>>[2];

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ') || undefined;
const node = z.any();
const children = z.array(node);
const step = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(8, Math.max(0, Math.round(n))) : fallback);
/** `gap` and `padding` count 4px steps, as the standard says. */
const gapVar = (n: unknown, fallback: number): CSSProperties => ({ '--gap': `${step(n, fallback) * 4}px` }) as CSSProperties;

const TONES = ['ink', 'muted', 'faint', 'info', 'success', 'warning', 'danger'] as const;
const tone = (value: unknown) => (typeof value === 'string' && (TONES as readonly string[]).includes(value) ? `aui-tone-${value}` : null);

const option = z.union([z.string(), z.object({ value: z.string(), label: z.string() })]);
const options = z.array(option);
const optionList = (raw: unknown) =>
  (Array.isArray(raw) ? raw : []).flatMap((o) => (typeof o === 'string' ? [{ value: o, label: o }] : o && typeof o === 'object' && typeof (o as { value?: unknown }).value === 'string' ? [{ value: (o as { value: string }).value, label: String((o as { label?: unknown }).label ?? (o as { value: string }).value) }] : []));

function useRunAction() {
  const trigger = useTriggerAction();
  const formName = useFormName();
  return (message: string, plan: unknown, sendLabel: boolean) => {
    if (plan) void trigger(message, formName, plan as Plan);
    else if (sendLabel) void trigger(message, formName);
  };
}

function useFieldName(label: unknown, statementId?: string) {
  const id = useId();
  return (typeof label === 'string' && label) || statementId || id;
}

/** A link this console may follow: one of its own paths, or an absolute http(s) address. */
export function safeHref(value: unknown): { href: string; internal: boolean } | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  if (/^\/(?!\/)[\w\-./?=&%#[\]@+,:~]*$/.test(href)) return { href, internal: true };
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? { href: url.toString(), internal: false } : null;
  } catch {
    return null;
  }
}

/* ---- Layout -------------------------------------------------------------------------------- */

const ALIGN = z.enum(['start', 'center', 'end', 'stretch']).optional();

export const Col = defineComponent({
  name: 'Col',
  props: z.object({ children, gap: z.number().optional(), align: ALIGN }),
  description: 'Vertical layout. gap counts 4px steps.',
  component: ({ props, renderNode }) => (
    <div className={cx('aui-col', props.align && `aui-align-${props.align}`)} style={gapVar(props.gap, 4)}>
      {renderNode(props.children)}
    </div>
  ),
});

export const Row = defineComponent({
  name: 'Row',
  props: z.object({ children, gap: z.number().optional(), align: ALIGN, justify: z.enum(['start', 'center', 'end', 'between']).optional(), wrap: z.boolean().optional() }),
  description: 'Horizontal layout; items are centred vertically unless align says otherwise.',
  component: ({ props, renderNode }) => (
    <div className={cx('aui-row', props.align && `aui-align-${props.align}`, props.justify && `aui-justify-${props.justify}`, props.wrap && 'aui-wrap')} style={gapVar(props.gap, 3)}>
      {renderNode(props.children)}
    </div>
  ),
});

export const Grid = defineComponent({
  name: 'Grid',
  props: z.object({ children, columns: z.number().optional(), minChildWidth: z.number().optional(), gap: z.number().optional() }),
  description: 'Children side by side: `columns` across (default 2), or as many as fit at minChildWidth px. One column on a phone.',
  component: ({ props, renderNode }) => {
    const min = typeof props.minChildWidth === 'number' && props.minChildWidth > 0 ? Math.min(640, props.minChildWidth) : null;
    const cols = Math.min(6, Math.max(1, Math.round(typeof props.columns === 'number' ? props.columns : 2)));
    const style = { ...gapVar(props.gap, 4), ...(min ? { '--min': `${min}px` } : { '--cols': cols }) } as CSSProperties;
    return (
      <div className={cx('aui-grid', min ? 'aui-grid--fit' : 'aui-grid--cols')} style={style}>
        {renderNode(props.children)}
      </div>
    );
  },
});

export const Card = defineComponent({
  name: 'Card',
  props: z.object({ children, variant: z.enum(['outline', 'soft']).optional(), padding: z.number().optional(), gap: z.number().optional() }),
  description: 'A ruled panel; soft is filled, for a summary or a tool.',
  component: ({ props, renderNode }) => (
    <section className={cx('aui-card', props.variant === 'soft' && 'aui-card--soft')} style={{ ...gapVar(props.gap, 2), '--pad': `${step(props.padding, 4) * 4}px` } as CSSProperties}>
      {renderNode(props.children)}
    </section>
  ),
});

export const Divider = defineComponent({ name: 'Divider', props: z.object({}), description: 'A hairline rule.', component: () => <hr className="aui-divider" /> });
export const Spacer = defineComponent({ name: 'Spacer', props: z.object({}), description: 'Fills the free space in a Row.', component: () => <span className="aui-spacer" aria-hidden="true" /> });

/* ---- Text ---------------------------------------------------------------------------------- */

export const Title = defineComponent({
  name: 'Title',
  props: z.object({ text: z.string(), size: z.enum(['sm', 'md', 'lg', 'xl', '2xl', '3xl']).optional(), color: z.string().optional() }),
  description: 'A heading. lg heads an answer, sm heads a panel; xl and above are for a figure.',
  component: ({ props }) => {
    const size = props.size ?? 'md';
    // A figure (xl and up) is a number, not a heading: headings stay in the outline, figures do not.
    const figure = size === 'xl' || size === '2xl' || size === '3xl';
    const Tag = figure ? 'p' : size === 'lg' ? 'h2' : 'h3';
    return <Tag className={cx('aui-title', `aui-title--${size}`, tone(props.color))}>{String(props.text ?? '')}</Tag>;
  },
});

export const Text = defineComponent({
  name: 'Text',
  props: z.object({
    text: z.union([z.string(), children]),
    size: z.enum(['xs', 'sm', 'md', 'lg']).optional(),
    color: z.string().optional(),
    weight: z.enum(['normal', 'medium', 'semibold']).optional(),
    italic: z.boolean().optional(),
    lineThrough: z.boolean().optional(),
    tabularNums: z.boolean().optional(),
    maxLines: z.number().optional(),
  }),
  description: 'A paragraph, or a run of inline pieces.',
  component: ({ props, renderNode }) => (
    <p className={cx('aui-text', `aui-text--${props.size ?? 'md'}`, tone(props.color), props.weight && props.weight !== 'normal' && 'aui-strong', props.italic && 'aui-italic', props.lineThrough && 'aui-struck', props.tabularNums && 'aui-tnum')}>
      {Array.isArray(props.text) ? renderNode(props.text) : String(props.text ?? '')}
    </p>
  ),
});

export const Caption = defineComponent({
  name: 'Caption',
  props: z.object({ text: z.string(), color: z.string().optional() }),
  description: 'A small label above a figure or under a chart.',
  component: ({ props }) => <p className={cx('aui-caption', tone(props.color))}>{String(props.text ?? '')}</p>,
});

export const Label = defineComponent({
  name: 'Label',
  props: z.object({ text: z.string() }),
  description: 'A short caps label for a group.',
  component: ({ props }) => <p className="aui-label">{String(props.text ?? '')}</p>,
});

const BADGE = ['neutral', 'info', 'success', 'warning', 'danger'] as const;
export const Badge = defineComponent({
  name: 'Badge',
  props: z.object({ text: z.string(), color: z.enum(['neutral', 'info', 'success', 'warning', 'danger', 'purple', 'pink']).optional() }),
  description: 'A state in a word or two.',
  component: ({ props }) => <span className={cx('aui-badge', `aui-badge--${(BADGE as readonly string[]).includes(props.color ?? '') ? props.color : 'neutral'}`)}>{String(props.text ?? '')}</span>,
});

export const Link = defineComponent({
  name: 'Link',
  props: z.object({ text: z.string(), url: z.string() }),
  description: 'A link to a console screen (a path) or an outside page.',
  component: ({ props }) => {
    const target = safeHref(props.url);
    const text = String(props.text ?? '');
    if (!target) return <span>{text}</span>;
    return target.internal ? (
      <NextLink className="aui-link" href={target.href}>
        {text}
      </NextLink>
    ) : (
      <a className="aui-link" href={target.href} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  },
});

export const ListItem = defineComponent({
  name: 'ListItem',
  props: z.object({ title: z.string(), description: z.string().optional(), marker: z.string().optional(), children: children.optional() }),
  description: 'One entry of a List: a title, a line under it, an optional marker (a time, a number, "done", "todo", "alert") and controls.',
  component: ({ props, renderNode }) => {
    const marker = typeof props.marker === 'string' ? props.marker : '';
    const state = marker === 'done' || marker === 'todo' || marker === 'alert' ? marker : null;
    return (
      <div className={cx('aui-item', state && `aui-item--${state}`)}>
        {marker ? (
          <span className="aui-item__marker">
            {state ? <AdminIcon name={state === 'done' ? 'check' : state === 'alert' ? 'alert' : 'arrow'} /> : marker}
            {state ? <span className="sr-only">{state === 'done' ? 'Done' : state === 'alert' ? 'Needs you' : 'To do'}</span> : null}
          </span>
        ) : null}
        <div className="aui-item__body">
          <p className="aui-item__title">{String(props.title ?? '')}</p>
          {props.description ? <p className="aui-item__description">{props.description}</p> : null}
          {props.children?.length ? <div className="aui-item__controls">{renderNode(props.children)}</div> : null}
        </div>
      </div>
    );
  },
});

export const List = defineComponent({
  name: 'List',
  props: z.object({ items: z.array(z.union([z.string(), node])), marker: z.enum(['bullet', 'number', 'none']).optional(), timeline: z.boolean().optional() }),
  description: 'Entries in order. timeline draws them down a line, each ListItem marker a time.',
  component: ({ props, renderNode }) => {
    const items = Array.isArray(props.items) ? props.items : [];
    const Tag = props.marker === 'number' ? 'ol' : 'ul';
    return (
      <Tag className={cx('aui-list', `aui-list--${props.marker ?? 'bullet'}`, props.timeline && 'aui-list--timeline')}>
        {items.map((item, i) => (
          <li key={i}>{typeof item === 'string' ? item : renderNode(item)}</li>
        ))}
      </Tag>
    );
  },
});

/* ---- Controls ------------------------------------------------------------------------------ */

export const Button = defineComponent({
  name: 'Button',
  props: z.object({
    label: z.string(),
    action: action().optional(),
    variant: z.enum(['solid', 'outline', 'soft', 'ghost']).optional(),
    color: z.enum(['primary', 'danger', 'success']).optional(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    icon: z.string().optional(),
    disabled: z.boolean().optional(),
    block: z.boolean().optional(),
  }),
  description: 'Runs its action; with none, sends its label as the next question.',
  component: function ButtonView({ props }) {
    const run = useRunAction();
    const label = String(props.label ?? '');
    return (
      <button type="button" className={cx('aui-button', `aui-button--${props.variant ?? 'outline'}`, props.color === 'danger' && 'aui-button--danger', props.size === 'sm' && 'aui-button--sm', props.block && 'aui-block')} aria-disabled={props.disabled || undefined} onClick={() => (props.disabled ? undefined : run(label, props.action, true))}>
        {isAdminIcon(props.icon) ? <AdminIcon name={props.icon} /> : null}
        {label}
      </button>
    );
  },
});

export const SegmentedControl = defineComponent({
  name: 'SegmentedControl',
  props: z.object({ value: reactive(z.string()), options, block: z.boolean().optional() }),
  description: '2 to 5 short choices in a row, bound to a $variable.',
  component: function SegmentedView({ props, statementId }) {
    const field = useStateField(useFieldName(undefined, statementId), props.value);
    const value = field.value == null ? '' : String(field.value);
    return (
      <div className={cx('aui-segmented', props.block && 'aui-block')} role="radiogroup">
        {optionList(props.options).map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => field.setValue(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    );
  },
});

export const Select = defineComponent({
  name: 'Select',
  props: z.object({ value: reactive(z.string()), options, label: z.string().optional(), placeholder: z.string().optional() }),
  description: 'A dropdown bound to a $variable, for longer lists of choices.',
  component: function SelectView({ props, statementId }) {
    const field = useStateField(useFieldName(props.label, statementId), props.value);
    const id = useId();
    const choices = optionList(props.options);
    const value = field.value == null ? '' : String(field.value);
    return (
      <span className="aui-field">
        <label htmlFor={id} className={props.label ? 'aui-caption' : 'sr-only'}>
          {props.label ?? props.placeholder ?? 'Choose'}
        </label>
        <select id={id} className="aui-select" value={value} onChange={(event) => field.setValue(event.target.value)}>
          {choices.some((o) => o.value === value) ? null : (
            <option value="" disabled>
              {props.placeholder ?? 'Choose'}
            </option>
          )}
          {choices.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    );
  },
});

/* ---- Data ---------------------------------------------------------------------------------- */

const NUMERIC = /^[-+]?[$£€]?\d[\d,]*(\.\d+)?\s*(%|ms|s|k|m|b)?$/i;
const isElement = (value: unknown) => !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'element';

export const Table = defineComponent({
  name: 'Table',
  props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.any())) }),
  description: 'Each row lists its cells in column order; a cell may be a component. Number columns align right.',
  component: ({ props, renderNode }) => {
    const columns = Array.isArray(props.columns) ? props.columns.map((c) => String(c ?? '')) : [];
    const rows = (Array.isArray(props.rows) ? props.rows : []).filter(Array.isArray) as unknown[][];
    if (!rows.length) {
      return (
        <p className="aui-empty" role="status">
          Nothing to list.
        </p>
      );
    }
    const numeric = columns.map((_, c) => {
      const cells = rows.map((r) => r[c]).filter((v) => v != null && v !== '' && v !== '—');
      return cells.length > 0 && cells.every((v) => typeof v === 'number' || (typeof v === 'string' && NUMERIC.test(v.trim())));
    });
    const cell = (value: unknown): ReactNode => (isElement(value) ? renderNode(value) : typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(value ?? ''));
    return (
      // Focusable so a keyboard can scroll a table wider than a phone (axe scrollable-region-focusable).
      <div className="aui-table-scroll" tabIndex={0} role="region" aria-label={`Table: ${columns.join(', ')}`}>
        <table className="aui-table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} scope="col" className={cx(numeric[i] && 'aui-num')}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {columns.map((_, c) => (
                  <td key={c} className={cx(numeric[c] && 'aui-num')}>
                    {cell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
});

export const Chart = defineComponent({
  name: 'Chart',
  props: z.object({
    type: z.enum(['bar', 'line', 'area', 'pie', 'donut']),
    data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    x: z.string().optional(),
    series: z.array(z.string()).optional(),
    format: z.enum(['number', 'currency', 'percent']).optional(),
    currency: z.string().optional(),
    stacked: z.boolean().optional(),
    height: z.number().optional(),
  }),
  description: 'Rows of data; x is the category key, series the value keys (default: every number key).',
  component: ({ props }) => <ChartView {...(props as ChartProps)} />,
});

/* ---- A change to the site ------------------------------------------------------------------ */

type ProposalState = { phase: 'idle' } | { phase: 'working'; what: string } | { phase: 'review'; summary: string; points: string[]; token?: string } | { phase: 'done'; message: string } | { phase: 'failed'; message: string; stepUp?: boolean };

export const Proposal = defineComponent({
  name: 'Proposal',
  props: z.object({
    title: z.string(),
    summary: z.string(),
    capability: z.string(),
    input: z.record(z.string(), z.any()),
    confirm: z.string(),
    danger: z.boolean().optional(),
    draft: z.string().optional(),
  }),
  description: 'A change to the site, proposed and not yet made: what it does, and a button that names the act. Nothing happens until a person presses it and confirms. `draft` names a capability that restates the change first.',
  component: function ProposalView({ props }) {
    const host = useAssistantHost();
    const [state, setState] = useState<ProposalState>({ phase: 'idle' });
    const allowed = host.mayPropose(props.capability) && (!props.draft || host.mayPropose(props.draft));

    const review = async () => {
      if (!props.draft) return setState({ phase: 'review', summary: props.summary, points: [] });
      setState({ phase: 'working', what: 'Checking what this changes' });
      const drafted = await host.call(props.draft, { input: props.input });
      if (!drafted.ok) return setState({ phase: 'failed', message: drafted.error?.message ?? 'That could not be prepared.', stepUp: drafted.error?.code === 'step_up_required' });
      // A draft step restates the change in its own words (`consequences`), which is what a person confirms.
      const stated = (drafted.data as { consequences?: unknown } | undefined)?.consequences;
      const points = Array.isArray(stated) ? stated.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
      setState({ phase: 'review', summary: props.summary, points, token: drafted.confirmation?.token });
    };

    const commit = async (token: string | undefined) => {
      setState({ phase: 'working', what: 'Saving' });
      const res = await host.call(props.capability, { input: props.input, idempotencyKey: host.newKey(), ...(token ? { confirmationToken: token } : {}) });
      if (!res.ok) return setState({ phase: 'failed', message: res.error?.message ?? 'That did not save.', stepUp: res.error?.code === 'step_up_required' });
      setState({ phase: 'done', message: 'Done. It is recorded in the audit trail.' });
      host.changed();
    };

    return (
      <section className={cx('aui-proposal', props.danger && 'aui-proposal--danger')} aria-label={`Proposed change: ${props.title}`}>
        <p className="aui-label">Proposed change</p>
        <p className="aui-title aui-title--md">{props.title}</p>
        <p className="aui-text aui-text--md aui-tone-muted">{props.summary}</p>
        {state.phase === 'review' && state.points.length ? (
          <ul className="aui-list aui-list--bullet aui-proposal__points">
            {state.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        ) : null}
        <div className="aui-proposal__actions" aria-live="polite">
          {!allowed ? (
            <p className="aui-text aui-text--sm aui-tone-muted">This change is made on its own screen, not from here.</p>
          ) : state.phase === 'idle' ? (
            <button type="button" className="aui-button aui-button--outline" onClick={review}>
              Review
            </button>
          ) : state.phase === 'working' ? (
            <p className="aui-text aui-text--sm aui-tone-muted" role="status">
              {state.what}…
            </p>
          ) : state.phase === 'review' ? (
            <>
              <button type="button" className={cx('aui-button aui-button--solid', props.danger && 'aui-button--danger')} onClick={() => commit(state.token)}>
                {props.confirm}
              </button>
              <button type="button" className="aui-button aui-button--ghost" onClick={() => setState({ phase: 'idle' })}>
                Not now
              </button>
            </>
          ) : state.phase === 'done' ? (
            <p className="aui-proposal__done" role="status">
              <AdminIcon name="check" /> {state.message}
            </p>
          ) : (
            <p className="aui-proposal__failed" role="alert">
              {state.message}{' '}
              {state.stepUp ? (
                <NextLink className="aui-link" href={`/step-up?next=${encodeURIComponent('/admin/assistant')}`}>
                  Confirm it’s you
                </NextLink>
              ) : (
                <button type="button" className="aui-link" onClick={() => setState({ phase: 'idle' })}>
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
      </section>
    );
  },
});

export const adminComponents = [Col, Row, Grid, Card, Divider, Spacer, Title, Text, Caption, Label, Badge, Link, List, ListItem, Button, SegmentedControl, Select, Table, Chart, Proposal];
