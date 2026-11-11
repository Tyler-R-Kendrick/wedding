'use client';

import { action, defineComponent, reactive, useFormName, useIsStreaming, useStateField, useTriggerAction } from '@openuidev/react-lang';
import { useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { z } from 'zod/v4';

/**
 * The layout, text and input pieces an answer is built from, in the site's own look. Ported in
 * shape from open-intelligent-ui (MIT; the notice is in ./functions.ts): the same names and
 * positional arguments the composer writes, styled only with this theme's tokens (../trip.css).
 * Only what the composer emits is here.
 */

type Plan = Parameters<ReturnType<typeof useTriggerAction>>[2];

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ') || undefined;
const node = z.any();
const children = z.array(node);
/** Gap in steps of the spacing scale: 1 is xs, 2 sm, 3 md, 4 lg, 5 xl. */
const gapClass = (gap: unknown) => (typeof gap === 'number' && Number.isFinite(gap) ? `trip-gap-${Math.min(5, Math.max(0, Math.round(gap)))}` : null);
const textOf = (el: HTMLElement | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);

/** Runs an action prop; with none, a button sends its own label as the guest's next request. */
function useRunAction() {
  const trigger = useTriggerAction();
  const formName = useFormName();
  return (message: string, plan: unknown, sendLabel: boolean) => {
    if (plan) void trigger(message, formName, plan as Plan);
    else if (sendLabel) void trigger(message, formName);
  };
}

export const Col = defineComponent({
  name: 'Col',
  props: z.object({ children, gap: z.number().optional() }),
  description: 'Vertical layout. gap counts steps of the spacing scale (1 to 5).',
  component: ({ props, renderNode }) => <div className={cx('trip-col', gapClass(props.gap))}>{renderNode(props.children)}</div>,
});

export const Row = defineComponent({
  name: 'Row',
  props: z.object({ children, gap: z.number().optional(), wrap: z.boolean().optional() }),
  description: 'Horizontal layout; items are vertically centred.',
  component: ({ props, renderNode }) => <div className={cx('trip-row', gapClass(props.gap), props.wrap && 'trip-row--wrap')}>{renderNode(props.children)}</div>,
});

export const Grid = defineComponent({
  name: 'Grid',
  props: z.object({ children }),
  description: 'Cards side by side where there is room, one column on a phone.',
  component: ({ props, renderNode }) => <div className="trip-grid">{renderNode(props.children)}</div>,
});

export const Card = defineComponent({
  name: 'Card',
  props: z.object({ children, variant: z.enum(['outline', 'soft']).optional() }),
  description: 'A panel; soft is filled, for a tool or a summary.',
  component: ({ props, renderNode }) => <section className={cx('trip-card', props.variant === 'soft' && 'trip-card--soft')}>{renderNode(props.children)}</section>,
});

export const Spacer = defineComponent({
  name: 'Spacer',
  props: z.object({}),
  description: 'Fills the free space in a Row.',
  component: () => <span className="trip-spacer" aria-hidden="true" />,
});

export const Title = defineComponent({
  name: 'Title',
  props: z.object({ text: z.string(), size: z.enum(['xl', 'lg', 'md']).optional() }),
  description: 'A heading. xl heads an answer; md heads a part of it.',
  component: ({ props }) => {
    const size = props.size ?? 'lg';
    const Tag = size === 'xl' ? 'h3' : 'h4';
    return <Tag className={`trip-title trip-title--${size}`}>{props.text}</Tag>;
  },
});

export const Text = defineComponent({
  name: 'Text',
  props: z.object({
    text: z.string(),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    tone: z.enum(['default', 'muted']).optional(),
    weight: z.enum(['regular', 'medium', 'semibold']).optional(),
  }),
  description: 'A paragraph.',
  component: ({ props }) => (
    <p className={cx('trip-text', `trip-text--${props.size ?? 'md'}`, props.tone === 'muted' && 'trip-text--muted', props.weight && props.weight !== 'regular' && 'trip-text--strong')}>
      {String(props.text ?? '')}
    </p>
  ),
});

export const Caption = defineComponent({
  name: 'Caption',
  props: z.object({ text: z.string() }),
  description: 'A short supporting line.',
  component: ({ props }) => <p className="trip-caption">{String(props.text ?? '')}</p>,
});

const BADGE: Record<string, string> = { neutral: 'bd-badge', info: 'bd-badge bd-badge--info', success: 'bd-badge bd-badge--ok', warning: 'bd-badge bd-badge--pending' };

export const Badge = defineComponent({
  name: 'Badge',
  props: z.object({ text: z.string(), tone: z.enum(['neutral', 'info', 'success', 'warning']).optional() }),
  description: 'A short label.',
  component: ({ props }) => <span className={cx(BADGE[props.tone ?? 'neutral'], 'trip-badge')}>{String(props.text ?? '')}</span>,
});

export const Button = defineComponent({
  name: 'Button',
  props: z.object({ label: z.string(), action: action().optional(), variant: z.enum(['primary', 'secondary', 'ghost']).optional() }),
  description: 'A button. With no action it sends its label as the next request.',
  component: function ButtonView({ props }) {
    const run = useRunAction();
    const streaming = useIsStreaming();
    const label = String(props.label ?? '');
    return (
      <button type="button" className={`bd-btn bd-btn--${props.variant ?? 'primary'} trip-button`} disabled={streaming} onClick={() => run(label, props.action, true)}>
        <span>{label}</span>
      </button>
    );
  },
});

export const Pressable = defineComponent({
  name: 'Pressable',
  props: z.object({ children, action: action().optional(), selected: z.boolean().optional() }),
  description: 'Makes a row selectable, such as a row of the time tool.',
  component: function PressableView({ props, renderNode }) {
    const run = useRunAction();
    const streaming = useIsStreaming();
    const ref = useRef<HTMLDivElement>(null);
    const press = () => {
      if (!streaming) run(textOf(ref.current), props.action, false);
    };
    // A click meant for a control inside the row stays with that control.
    const onClick = (event: MouseEvent<HTMLDivElement>) => {
      const target = (event.target as Element).closest('button,a,input,select,textarea,label,[role=button],[role=checkbox]');
      if (target === event.currentTarget) press();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      press();
    };
    const selectable = props.selected !== undefined;
    return (
      <div
        ref={ref}
        role={selectable ? 'checkbox' : 'button'}
        tabIndex={0}
        aria-checked={selectable ? !!props.selected : undefined}
        aria-disabled={streaming || undefined}
        className={cx('trip-pressable', props.selected && 'is-selected')}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {selectable ? <span className="trip-pressable__tick" aria-hidden="true" /> : null}
        <div className="trip-pressable__body">{renderNode(props.children) as ReactNode}</div>
      </div>
    );
  },
});

export const Slider = defineComponent({
  name: 'Slider',
  props: z.object({
    value: reactive(z.number()),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    label: z.string().optional(),
    unit: z.string().optional(),
  }),
  description: 'A range with a visible label and value; bind value to a $variable.',
  component: function SliderView({ props, statementId }) {
    const fallback = useId();
    const field = useStateField(props.label || statementId || fallback, props.value);
    const id = useId();
    const min = Number.isFinite(props.min) ? props.min : 0;
    const max = Number.isFinite(props.max) && props.max > min ? props.max : min + 100;
    const step = props.step && props.step > 0 ? props.step : 1;
    const raw = typeof field.value === 'number' ? field.value : Number(field.value);
    const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min;
    const readout = `${value.toLocaleString('en-US')}${props.unit ?? ''}`;
    return (
      <div className="trip-slider">
        <div className="trip-slider__head">
          <label htmlFor={id}>{props.label ?? 'Value'}</label>
          <output htmlFor={id}>{readout}</output>
        </div>
        <input id={id} className="trip-slider__range" type="range" min={min} max={max} step={step} value={value} aria-valuetext={readout} onChange={(e) => field.setValue(Number(e.target.value))} />
      </div>
    );
  },
});

export const SegmentedControl = defineComponent({
  name: 'SegmentedControl',
  props: z.object({ value: reactive(z.string()), options: z.array(z.string()), label: z.string().optional() }),
  description: 'Two to four short choices in a row; bind value to a $variable.',
  component: function SegmentedView({ props, statementId }) {
    const fallback = useId();
    const field = useStateField(statementId || fallback, props.value);
    const value = field.value == null ? '' : String(field.value);
    const options = (Array.isArray(props.options) ? props.options : []).filter((o): o is string => typeof o === 'string' && !!o.trim());
    const pick = (i: number) => {
      const o = options[(i + options.length) % options.length];
      if (o !== undefined) field.setValue(o);
    };
    // A radio group: arrow keys move the choice, as a guest using a keyboard expects.
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const i = options.indexOf(value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') pick(i + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') pick(i - 1);
      else return;
      event.preventDefault();
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]');
      buttons[(i + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
    };
    return (
      <div className="trip-segmented" role="radiogroup" aria-label={props.label ?? 'Choose'} onKeyDown={onKeyDown}>
        {options.map((o) => {
          const on = o === value;
          return (
            <button key={o} type="button" role="radio" aria-checked={on} tabIndex={on || (!value && o === options[0]) ? 0 : -1} className={cx('trip-segmented__option', on && 'is-selected')} onClick={() => field.setValue(o)}>
              {o}
            </button>
          );
        })}
      </div>
    );
  },
});

export const primitives = [Col, Row, Grid, Card, Spacer, Title, Text, Caption, Badge, Button, Pressable, Slider, SegmentedControl];
