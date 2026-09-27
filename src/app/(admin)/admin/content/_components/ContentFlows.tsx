'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { AdminFlow, type FieldErrors, type FlowContext, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, CheckGroupField, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { swapOrder } from '@/components/admin/flow/order';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
import type { ContentRecordData } from '@/capabilities/get_content_record';
// Types only: the module itself is server code (drizzle, the database schema).
import type { FieldSpec, SubFieldSpec } from '@/domain/content/admin';
import { withArticle, type ContentEditor, type RefOption } from './types';
import './content-flows.css';
import { formatStamp } from '@/components/admin/flow/dates';

/*
 * The content editor, as flows from the admin kit (`components/admin/flow/CONVENTIONS.md`).
 *
 * It stays generic: one field spec per table (`TABLE_SPECS` in domain/content/admin.ts) drives the
 * steps, the controls and the conversion. The spec's own fields come first ("What it says", split
 * in two when a table has many), then the provenance every record carries (ADR-0011), then the
 * whole record read back.
 *
 * The admin never types an id. A slug or key is left to the server, which makes it from the title
 * (`derive`); it can be changed under "Technical details". A list position is set by Up and Down on
 * the table's page, never typed: a new record goes to the end. A source, a place, a memory, the
 * adventure a timeline stop opens or the operational detail a recommendation shows is chosen by
 * name. Lists are lines or rows, not JSON.
 *
 * Values are strings (or arrays and objects of strings) in the flow and are converted here, in the
 * browser, before the one `save_content_record` call. That is also where a `datetime-local` value
 * has to become an instant: only the browser knows which time zone the admin typed it in. The
 * capability validates everything again against the table's zod schema, and its field errors bring
 * the admin back to the step that owns the field.
 */

type Row = Record<string, string>;
type Values = Record<string, unknown> & {
  /** The stored instants of the datetime fields, so an untouched one is saved to the millisecond rather than to the minute its input shows. */
  __orig?: Record<string, string>;
};

/**
 * AdminFlow names its own elements `${uid}-title` and `${uid}-step`, and a field's input is
 * `${uid}-${name}`: a field called `title` would share the sheet title's id, and its label would
 * point at that heading instead of the input. So those fields go by another name in the flow and
 * keep their own on the way to and from the server (`stored`).
 */
const TAKEN_IDS = new Set(['title', 'step']);
type FlowField = FieldSpec & { stored?: string };
const stored = (f: FieldSpec) => (f as FlowField).stored ?? f.name;
const forFlow = (fields: FieldSpec[]): FieldSpec[] => fields.map((f) => (TAKEN_IDS.has(f.name) ? ({ ...f, name: `record-${f.name}`, stored: f.name } as FlowField) : f));
const flowName = (name: string) => (TAKEN_IDS.has(name) ? `record-${name}` : name);

/** The provenance fields every table shares, which get their own step. */
const PROVENANCE = new Set(['sourceId', 'sourceType', 'sourceUrl', 'verifiedAt', 'validFrom', 'validUntil', 'trustClass', 'visibility', 'placeholder']);
/** More spec fields than this on one step and it is split in two. */
const PER_STEP = 8;

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO instant as a `datetime-local` value in this browser's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/** The server's `slugify` (domain/content/admin.ts), for showing what an empty slug will become. */
function slugPreview(text: unknown): string {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What to say when a required field is empty: the spec's sentence, or one naming the field. */
const need = (f: FieldSpec) => f.ask ?? `Enter the ${lower(f.label)}.`;

/** A stored object as the strings a row of inputs edits; `null` values are left out. */
function strings(o: unknown): Row {
  if (!o || typeof o !== 'object') return {};
  return Object.fromEntries(
    Object.entries(o as Record<string, unknown>)
      .filter(([, x]) => x !== null && x !== undefined)
      .map(([k, x]) => [k, String(x)]),
  );
}

function jsonToFlow(f: FieldSpec, v: unknown): unknown {
  switch (f.editor) {
    case 'lines':
    case 'tags':
      return Array.isArray(v) ? v.map(String).join('\n') : '';
    case 'refs':
      return Array.isArray(v) ? v.map(String) : [];
    case 'rows':
      return Array.isArray(v) ? v.map(strings) : [];
    case 'object':
      return strings(v);
    default:
      return v === null || v === undefined ? '' : JSON.stringify(v, null, 2);
  }
}

function emptyJson(f: FieldSpec): unknown {
  return f.editor === 'refs' || f.editor === 'rows' ? [] : f.editor === 'object' ? {} : '';
}

/** A stored record → the flow's values. */
function toFlowValues(fields: FieldSpec[], row: Record<string, unknown>): Values {
  const out: Values = { __orig: {} };
  for (const f of fields) {
    const v = row[stored(f)];
    switch (f.type) {
      case 'boolean':
        out[f.name] = v === true;
        break;
      case 'tristate':
        out[f.name] = v === true ? 'yes' : v === false ? 'no' : '';
        break;
      case 'json':
        out[f.name] = jsonToFlow(f, v);
        break;
      case 'datetime':
        out[f.name] = isBlank(v) ? '' : toLocalInput(String(v));
        if (!isBlank(v)) out.__orig![f.name] = String(v);
        break;
      default:
        out[f.name] = v === null || v === undefined ? '' : String(v);
    }
  }
  return out;
}

function blankValues(fields: FieldSpec[], defaults: Record<string, string> = {}): Values {
  const out: Values = { __orig: {} };
  for (const f of fields) out[f.name] = f.type === 'boolean' ? defaults[f.name] === 'true' : f.type === 'json' ? emptyJson(f) : (defaults[f.name] ?? '');
  return out;
}

type Converted = { value?: unknown; error?: string };

/** One row or object of sub-fields → its stored shape, or the sentence saying what is missing. */
function convertItem(items: SubFieldSpec[], row: Row, where: string, blankAs: 'omit' | 'null'): { value?: Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {};
  // Keys the editor does not show (a photo's asset id) are kept as they were.
  for (const [k, x] of Object.entries(row)) if (!items.some((i) => i.name === k) && x.trim() !== '') out[k] = x;
  for (const i of items) {
    const x = text(row[i.name]);
    if (x === '') {
      if (i.required) return { error: `${where}: add the ${lower(i.label)}.` };
      if (blankAs === 'null') out[i.name] = null;
      continue;
    }
    if (i.type === 'number') {
      const n = Number(x);
      if (!Number.isInteger(n) || n <= 0) return { error: `${where}: enter the ${lower(i.label)} as a whole number, like 45.` };
      out[i.name] = n;
      continue;
    }
    if (i.minLength && x.length < i.minLength) return { error: `${where}: the ${lower(i.label)} needs at least ${i.minLength} characters.` };
    if (i.startsWith && !x.startsWith(i.startsWith)) return { error: `${where}: the ${lower(i.label)} starts with ${i.startsWith}.` };
    out[i.name] = x;
  }
  return { value: out };
}

function convertJson(f: FieldSpec, raw: unknown): Converted {
  switch (f.editor) {
    case 'lines':
    case 'tags': {
      let items = String(raw ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      if (f.editor === 'tags') items = [...new Set(items.map((s) => slugPreview(s)).filter(Boolean))];
      if (!items.length && f.required) return { error: need(f) };
      return { value: items };
    }
    case 'refs': {
      const ids = Array.isArray(raw) ? raw.map(String) : [];
      if (!ids.length && f.required) return { error: need(f) };
      return { value: ids };
    }
    case 'rows': {
      const items = f.items ?? [];
      const rows = (Array.isArray(raw) ? raw : []) as Row[];
      const out: Record<string, unknown>[] = [];
      for (const [n, row] of rows.entries()) {
        // A row left completely empty is not saved.
        if (items.every((i) => text(row[i.name]) === '')) continue;
        const r = convertItem(items, row, `${f.itemLabel ?? 'Row'} ${n + 1}`, 'omit');
        if (r.error) return { error: r.error };
        out.push(r.value!);
      }
      if (!out.length && f.required) return { error: need(f) };
      return { value: out };
    }
    case 'object': {
      const items = f.items ?? [];
      const row = (raw && typeof raw === 'object' ? raw : {}) as Row;
      if (items.every((i) => text(row[i.name]) === '')) return f.required ? { error: need(f) } : { value: null };
      const r = convertItem(items, row, f.label, 'null');
      return r.error ? { error: r.error } : { value: r.value };
    }
    default: {
      const v = text(raw);
      if (v === '') return f.required ? { error: need(f) } : { value: null };
      try {
        return { value: JSON.parse(v) };
      } catch {
        return { error: `The ${lower(f.label)} could not be read. ${f.help ?? ''}`.trim() };
      }
    }
  }
}

/** One field's flow value → what `save_content_record` takes, or the sentence saying what to fix. */
function convert(f: FieldSpec, raw: unknown, orig: Record<string, string> | undefined): Converted {
  if (f.type === 'boolean') return { value: raw === true };
  if (f.type === 'json') return convertJson(f, raw);
  const v = text(raw);
  if (f.type === 'tristate') return { value: v === 'yes' ? true : v === 'no' ? false : null };
  // A derived value left empty is made by the server (a slug from the title, a place at the end).
  if (v === '') return f.required && !f.derive ? { error: need(f) } : { value: null };
  switch (f.type) {
    case 'number': {
      const n = Number(v);
      return Number.isInteger(n) ? { value: n } : { error: `Enter the ${lower(f.label)} as a whole number, like 45.` };
    }
    case 'float': {
      const n = Number(v);
      return Number.isFinite(n) ? { value: n } : { error: `Enter the ${lower(f.label)} as a number, like 41.8819.` };
    }
    case 'url':
      return /^https:\/\/\S+$/.test(v) ? { value: v } : { error: `Enter the whole address of the ${lower(f.label)}, starting with https://.` };
    case 'datetime': {
      const stored = orig?.[f.name];
      if (stored && toLocalInput(stored) === v) return { value: stored };
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? { error: `Enter a date and time for “${f.label}”.` } : { value: d.toISOString() };
    }
    default:
      return { value: v };
  }
}

function check(fields: FieldSpec[], values: Values): FieldErrors {
  const errors: FieldErrors = {};
  for (const f of fields) {
    const r = convert(f, values[f.name], values.__orig);
    if (r.error) errors[f.name] = r.error;
  }
  return errors;
}

function toData(fields: FieldSpec[], values: Values): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) data[stored(f)] = convert(f, values[f.name], values.__orig).value;
  return data;
}

/** True while any of the record's own text still carries the placeholder marker. */
function mentionsMarker(fields: FieldSpec[], values: Values, marker: string): boolean {
  return fields.some((f) => !PROVENANCE.has(f.name) && f.type !== 'boolean' && JSON.stringify(values[f.name] ?? '').includes(marker));
}

const refLabel = (options: RefOption[] | undefined, id: unknown) => options?.find((o) => o.value === String(id))?.label ?? 'A record that is no longer listed';

/** A value read back on the last step, in words. */
function shown(f: FieldSpec, raw: unknown, editor: ContentEditor): string {
  if (f.type === 'boolean') return raw === true ? 'Yes' : 'No';
  if (f.type === 'tristate') return raw === 'yes' ? 'Yes' : raw === 'no' ? 'No' : 'Not known';
  if (f.type === 'json') {
    const r = convertJson(f, raw);
    const v = r.value;
    if (!Array.isArray(v)) {
      if (f.editor === 'object' && v && typeof v === 'object')
        return (f.items ?? [])
          .map((i) => ((v as Record<string, unknown>)[i.name] === null ? null : `${i.label}: ${String((v as Record<string, unknown>)[i.name])}`))
          .filter(Boolean)
          .join(' · ');
      return '';
    }
    if (v.length === 0) return '';
    if (f.editor === 'refs') return v.map((id) => refLabel(editor.refs[f.ref ?? ''], id)).join(' · ');
    if (f.editor === 'rows') return `${v.length} ${lower(f.itemLabel ?? 'row')}${v.length === 1 ? '' : 's'}`;
    return clip(v.map(String).join(' · '));
  }
  const v = text(raw);
  if (v === '') return '';
  if (f.name === 'sourceId') return editor.sources.find((s) => s.value === v)?.label ?? 'A source that is not in the list';
  if (f.pick) return editor.picks[f.pick]?.find((o) => o.value === v)?.label ?? `${v} (not listed)`;
  if (f.type === 'select') return f.optionLabels?.[v] ?? v;
  if (f.ref) return refLabel(editor.refs[f.ref], v);
  if (f.type === 'datetime') return formatStamp(v);
  return clip(v);
}

const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 157)}…` : s);

/** Options for a select, with a stored value that is no longer on the list kept as its own option. */
function withCurrent(options: { value: string; label: string }[], current: unknown, missing: string) {
  const v = text(current);
  return v && !options.some((o) => o.value === v) ? [...options, { value: v, label: missing }] : options;
}

// ------------------------------------------------------------------------------------ fields

function Hint({ id, children }: { id: string; children?: ReactNode }) {
  return children ? (
    <p id={id} className="flow-hint">
      {children}
    </p>
  ) : null;
}

function Problem({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="flow-field-error">
      {message}
    </p>
  ) : null;
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

/** One input of a row or object editor, marked up as the kit's `TextField`. */
function SubInput({ id, item, value, onChange, refs }: { id: string; item: SubFieldSpec; value: string; onChange: (v: string) => void; refs: Record<string, RefOption[]> }) {
  const hintId = `${id}-hint`;
  return (
    <div className="flow-field">
      <label htmlFor={id} className="flow-label">
        {item.label}
        {item.required ? null : <span className="flow-optional"> (optional)</span>}
      </label>
      {item.ref ? (
        <select id={id} className="ops-input flow-input" value={value} aria-describedby={item.help ? hintId : undefined} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose one</option>
          {withCurrent(refs[item.ref] ?? [], value, 'A record that is no longer listed').map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="ops-input flow-input"
          type={item.type === 'number' ? 'number' : 'text'}
          inputMode={item.type === 'number' ? 'numeric' : undefined}
          min={item.type === 'number' ? 1 : undefined}
          step={item.type === 'number' ? 1 : undefined}
          autoComplete="off"
          value={value}
          aria-describedby={item.help ? hintId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <Hint id={hintId}>{item.help}</Hint>
    </div>
  );
}

/** A list of things with several parts each (photos, an itinerary's stops): one group per item. */
function RowsField({ ctx, field: f, refs }: { ctx: FlowContext<Values>; field: FieldSpec; refs: Record<string, RefOption[]> }) {
  const rows = (Array.isArray(ctx.values[f.name]) ? ctx.values[f.name] : []) as Row[];
  const items = f.items ?? [];
  const noun = f.itemLabel ?? 'Row';
  const error = ctx.errors[f.name];
  const base = `${ctx.uid}-${f.name}`;
  const put = (next: Row[]) => ctx.set({ [f.name]: next });
  const edit = (i: number, patch: Row) => put(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    put(next);
  };
  const add = () => {
    put([...rows, {}]);
    window.requestAnimationFrame(() => document.getElementById(`${base}-${rows.length}-${items[0]?.name ?? ''}`)?.focus());
  };
  const remove = (i: number) => {
    put(rows.filter((_, j) => j !== i));
    window.requestAnimationFrame(() => document.getElementById(`${base}-add`)?.focus());
  };
  return (
    <fieldset className="cf-group" aria-describedby={describedBy(f.help && `${base}-hint`, error && `${base}-error`)} data-invalid={error ? '' : undefined}>
      <legend className="flow-label">
        {f.label}
        {f.required ? null : <span className="flow-optional"> (optional)</span>}
      </legend>
      <Hint id={`${base}-hint`}>{f.help}</Hint>
      {rows.map((row, i) => (
        <fieldset key={i} className="cf-item">
          <legend className="cf-item__legend">
            {noun} {i + 1}
          </legend>
          {items.map((item, k) => (
            <SubInput
              key={item.name}
              // The first input of the first row answers to the field's own id, so a check that fails focuses it.
              id={i === 0 && k === 0 ? base : `${base}-${i}-${item.name}`}
              item={item}
              value={row[item.name] ?? ''}
              refs={refs}
              onChange={(v) => edit(i, { [item.name]: v })}
            />
          ))}
          <div className="cf-item__actions">
            <button type="button" className="flow-trigger-quiet" aria-disabled={i === 0 || undefined} aria-label={`Move ${lower(noun)} ${i + 1} up`} onClick={() => move(i, -1)}>
              Up
            </button>
            <button type="button" className="flow-trigger-quiet" aria-disabled={i === rows.length - 1 || undefined} aria-label={`Move ${lower(noun)} ${i + 1} down`} onClick={() => move(i, 1)}>
              Down
            </button>
            <button type="button" className="flow-trigger-quiet flow-trigger-danger" aria-label={`Delete ${lower(noun)} ${i + 1}`} onClick={() => remove(i)}>
              Delete
            </button>
          </div>
        </fieldset>
      ))}
      <div className="cf-item__actions">
        <button type="button" id={rows.length ? `${base}-add` : base} className="ops-button ops-button-ghost" onClick={add}>
          Add {withArticle(lower(noun))}
        </button>
      </div>
      <Problem id={`${base}-error`} message={error} />
    </fieldset>
  );
}

/** One object with a few named parts (a space's capacities). */
function ObjectField({ ctx, field: f, refs }: { ctx: FlowContext<Values>; field: FieldSpec; refs: Record<string, RefOption[]> }) {
  const row = (ctx.values[f.name] && typeof ctx.values[f.name] === 'object' ? ctx.values[f.name] : {}) as Row;
  const error = ctx.errors[f.name];
  const base = `${ctx.uid}-${f.name}`;
  return (
    <fieldset className="cf-item" aria-describedby={describedBy(f.help && `${base}-hint`, error && `${base}-error`)}>
      <legend className="cf-item__legend">{f.label}</legend>
      <Hint id={`${base}-hint`}>{f.help}</Hint>
      {(f.items ?? []).map((item, k) => (
        <SubInput key={item.name} id={k === 0 ? base : `${base}-${item.name}`} item={item} value={row[item.name] ?? ''} refs={refs} onChange={(v) => ctx.set({ [f.name]: { ...row, [item.name]: v } })} />
      ))}
      <Problem id={`${base}-error`} message={error} />
    </fieldset>
  );
}

function Field({ ctx, field: f, editor, isNew }: { ctx: FlowContext<Values>; field: FieldSpec; editor: ContentEditor; isNew: boolean }) {
  const optional = !f.required || Boolean(f.derive);
  const opts = (options: readonly string[] = []) => options.map((o) => ({ value: o, label: f.optionLabels?.[o] ?? o }));

  if (f.name === 'sourceId') {
    // Choosing a source sets what follows from it: its kind, how far it is trusted, its official page.
    const sourceCtx: FlowContext<Values> = {
      ...ctx,
      set: (patch) => {
        const src = editor.sources.find((s) => s.value === patch.sourceId);
        ctx.set(src ? { ...patch, sourceType: src.sourceType, trustClass: src.trustClass, ...(src.url && isBlank(ctx.values.sourceUrl) ? { sourceUrl: src.url } : {}) } : patch);
      },
    };
    return (
      <SelectField
        ctx={sourceCtx}
        name={f.name}
        label={f.label}
        hint={f.help}
        placeholder="Choose a source"
        options={withCurrent(
          editor.sources.map((s) => ({ value: s.value, label: s.label })),
          ctx.values[f.name],
          'A source that is not in the list',
        )}
      />
    );
  }
  if (f.pick) {
    // Named by web address name or key, but chosen by title: nobody types "outlet.cindys".
    return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional placeholder="None" options={withCurrent(editor.picks[f.pick] ?? [], ctx.values[f.name], `${text(ctx.values[f.name])} (not listed)`)} />;
  }
  if (f.ref && f.type === 'text') {
    return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional placeholder="None" options={withCurrent(editor.refs[f.ref] ?? [], ctx.values[f.name], 'A record that is no longer listed')} />;
  }
  if (f.derive === 'slug' || f.derive === 'key') {
    const made = slugPreview(ctx.values[flowName(editor.titleField)]);
    const preview = f.derive === 'key' && !isBlank(ctx.values.kind) ? `${String(ctx.values.kind)}.${made}` : made;
    const hint = (
      <>
        {f.help}
        {isNew && isBlank(ctx.values[f.name]) && made ? <> Left empty, it becomes “{preview}”.</> : null}
        {!isNew ? <> Changing it breaks any link to the old address.</> : null}
      </>
    );
    return <TextField ctx={ctx} name={f.name} label={f.label} hint={hint} optional spellCheck={false} />;
  }
  switch (f.type) {
    case 'boolean':
      return <CheckField ctx={ctx} name={f.name} label={f.label} hint={f.help} />;
    case 'tristate':
      return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional placeholder="Not known" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
    case 'select':
      return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} placeholder={optional ? 'Not set' : 'Choose one'} options={withCurrent(opts(f.options), ctx.values[f.name], String(ctx.values[f.name] ?? ''))} />;
    case 'textarea':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} multiline />;
    case 'json':
      if (f.editor === 'rows') return <RowsField ctx={ctx} field={f} refs={editor.refs} />;
      if (f.editor === 'object') return <ObjectField ctx={ctx} field={f} refs={editor.refs} />;
      if (f.editor === 'refs') {
        // Several records ticked from a list (the recommendations that go with a memory); one ticked
        // before and since removed stays, by what it was, so saving does not drop it silently.
        const options = editor.refs[f.ref ?? ''] ?? [];
        const picked = Array.isArray(ctx.values[f.name]) ? (ctx.values[f.name] as string[]) : [];
        const choices = [...options, ...picked.filter((id) => !options.some((o) => o.value === id)).map((id) => ({ value: id, label: 'A record that is no longer listed' }))];
        const hint = choices.length ? f.help : <>{f.help} Nothing to choose from yet.</>;
        return <CheckGroupField ctx={ctx} name={f.name} legend={optional ? `${f.label} (optional)` : f.label} choices={choices} hint={hint} />;
      }
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} multiline rows={f.editor ? 5 : 6} spellCheck={f.editor === 'lines'} />;
    case 'number':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} type="number" />;
    case 'float':
      // Not type="number": the kit's number input steps by whole numbers, and a latitude is not one.
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} inputMode="decimal" spellCheck={false} />;
    case 'url':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} type="url" inputMode="url" spellCheck={false} />;
    case 'date':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} type="date" />;
    case 'datetime':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} type="datetime-local" />;
    default:
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} />;
  }
}

/**
 * Internals the admin rarely needs (a slug, a trust class), closed by default. It opens by itself
 * when a check or the server finds a problem inside it, so the error is never hidden.
 */
function TechnicalDetails({ ctx, fields, children }: { ctx: FlowContext<Values>; fields: FieldSpec[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const problem = fields.some((f) => ctx.errors[f.name]);
  return (
    <details className="flow-details" open={open || problem} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Technical details</summary>
      <div className="flow-details__body">{children}</div>
    </details>
  );
}

function fieldStep(title: string, lede: string, main: FieldSpec[], technical: FieldSpec[], all: FieldSpec[], editor: ContentEditor, isNew: boolean, extra?: (v: Values) => FieldErrors): FlowStep<Values> {
  const own = [...main, ...technical];
  return {
    title,
    lede,
    fields: own.map((f) => f.name),
    render: (ctx) => (
      <>
        {main.map((f) => (
          <Field key={f.name} ctx={ctx} field={f} editor={editor} isNew={isNew} />
        ))}
        {technical.length ? (
          <TechnicalDetails ctx={ctx} fields={technical}>
            {technical.map((f) => (
              <Field key={f.name} ctx={ctx} field={f} editor={editor} isNew={isNew} />
            ))}
          </TechnicalDetails>
        ) : null}
      </>
    ),
    next: async (v) => {
      const errors = { ...check(own, v), ...(extra?.(v) ?? {}) };
      if (Object.keys(errors).length) return { errors };
      // Text that still says TODO(Tyler & Sara) is a placeholder: tick the box for the admin.
      if (!v.placeholder && mentionsMarker(all, v, editor.marker)) return { patch: { placeholder: true } };
    },
  };
}

/** The server's issue paths name a nested item (`media.0.alt`); the flow knows fields by their top-level name, and says each in words. */
function inWords(res: CapabilityResponse, fields: FieldSpec[], marker: string): CapabilityResponse {
  const issues = res.error?.details?.issues as { path: string; message: string }[] | undefined;
  if (res.ok || !issues?.length) return res;
  const known: Record<string, string> = {
    'required for official-web': 'Enter the official page: a record from an official website needs one.',
    'before validFrom': '“Hidden after” has to be later than “Shown from”.',
    'must be true while the text contains the placeholder marker': `Tick this box: the text still says ${marker}.`,
    'unknown content_sources id': 'Choose a source from the list.',
  };
  const mapped = issues.map((i) => {
    const [head = '', index, sub] = i.path.split('.');
    const f = fields.find((x) => stored(x) === head);
    const message = known[i.message] ?? i.message;
    if (!f || index === undefined) return { path: f?.name ?? head, message };
    const item = f.items?.find((x) => x.name === (sub ?? index));
    const where = f.editor === 'rows' && /^\d+$/.test(index) ? `${f.itemLabel ?? 'Row'} ${Number(index) + 1}` : f.label;
    return { path: f.name, message: `${where}${item ? `, ${lower(item.label)}` : ''}: ${message}` };
  });
  return { ...res, error: { ...res.error!, details: { ...res.error!.details, issues: mapped } } };
}

export interface ContentRecordFlowProps {
  editor: ContentEditor;
  /** Editing: the record to load. Omitted: a new record. */
  record?: { id: string; title: string };
  label: string;
  variant?: 'primary' | 'ghost' | 'quiet';
  accessibleName?: string;
  /** After adding, keep the sheet open on a link to the new record (the `/new` route, which lists nothing). */
  linkAfterCreate?: boolean;
  /** Open on arrival: the `/new` route exists only for this flow. */
  defaultOpen?: boolean;
}

/**
 * Add or edit a record of any content table: what it says, where it comes from and who sees it,
 * then the whole record read back before one save.
 */
export function ContentRecordFlow({ editor, record, label, variant = 'primary', accessibleName, linkAfterCreate, defaultOpen }: ContentRecordFlowProps) {
  const { table, noun } = editor;
  const fields = forFlow(editor.fields);
  const isNew = !record;
  // A list position is never asked for: Up and Down on the table's page set it, and a new record goes last.
  const asked = fields.filter((f) => f.derive !== 'position');
  const own = asked.filter((f) => !PROVENANCE.has(f.name));
  const ownMain = own.filter((f) => !f.technical);
  const ownTechnical = own.filter((f) => f.technical);
  const provenance = asked.filter((f) => PROVENANCE.has(f.name));
  const half = Math.ceil(ownMain.length / 2);
  const split = ownMain.length > PER_STEP;
  const ownSteps = split
    ? [
        fieldStep('What it says', 'The record as guests and the concierge will read it.', ownMain.slice(0, half), [], fields, editor, isNew),
        fieldStep('More details', 'The rest of the record: leave anything marked optional empty.', ownMain.slice(half), ownTechnical, fields, editor, isNew),
      ]
    : [fieldStep('What it says', 'The record as guests and the concierge will read it.', ownMain, ownTechnical, fields, editor, isNew)];

  // A new record's verification stamp is "now", on this device's clock and in its time zone.
  const initial = record ? blankValues(fields) : blankValues(fields, { ...editor.defaults, verifiedAt: toLocalInput(new Date().toISOString()) });

  const steps: FlowStep<Values>[] = [
    ...ownSteps,
    fieldStep(
      'Where it comes from',
      'Where the facts come from, when they were last checked, and who can see them.',
      provenance.filter((f) => !f.technical),
      provenance.filter((f) => f.technical),
      fields,
      editor,
      isNew,
      (v) => {
        const errors: FieldErrors = {};
        if (v.sourceType === 'official-web' && isBlank(v.sourceUrl)) errors.sourceUrl = 'Enter the official page: a record from an official website needs one.';
        const from = convert(fields.find((f) => f.name === 'validFrom')!, v.validFrom, v.__orig).value;
        const until = convert(fields.find((f) => f.name === 'validUntil')!, v.validUntil, v.__orig).value;
        if (typeof from === 'string' && typeof until === 'string' && Date.parse(from) > Date.parse(until)) errors.validUntil = '“Hidden after” has to be later than “Shown from”.';
        if (!v.placeholder && mentionsMarker(fields, v, editor.marker)) errors.placeholder = `Tick this box: the text still says ${editor.marker}.`;
        return errors;
      },
    ),
    {
      title: 'Check and save',
      lede: record ? 'Saving keeps the previous version in the record’s history.' : 'Nothing is saved until you press the button below.',
      render: ({ values }) => <ReviewList items={asked.filter((f) => !f.technical).map((f) => ({ label: f.label, value: shown(f, values[f.name], editor) }))} />,
    },
  ];

  const title = record ? `Edit ${record.title}` : `Add ${withArticle(noun)}`;
  return (
    <AdminFlow<Values>
      id={`content:${table}:${record?.id ?? 'new'}`}
      title={title}
      trigger={{ label, variant, accessibleName: accessibleName ?? (record ? title : undefined) }}
      defaultOpen={defaultOpen}
      initial={initial}
      steps={steps}
      load={
        record
          ? async () => {
              const res = await callCapability<ContentRecordData>('get_content_record', { input: { table, id: record.id } });
              if (!res.ok || !res.data) return res.error?.message ?? 'This record could not be loaded. Please try again.';
              return toFlowValues(fields, res.data.values);
            }
          : undefined
      }
      submit={{
        label: record ? `Save ${noun}` : `Add ${withArticle(noun)}`,
        success: record ? `${record.title} saved. The previous version is kept in its history.` : `Added ${withArticle(noun)} to ${editor.tableLabel}.`,
        run: async (v) => inWords(await callCapability('save_content_record', { input: { table, id: record?.id, data: toData(fields, v) }, idempotencyKey: newIdempotencyKey() }), fields, editor.marker),
        result:
          !record && linkAfterCreate
            ? (data) => {
                const d = data as { id: string };
                return (
                  <p>
                    It is saved as a private draft unless you chose otherwise. <Link href={`/admin/content/${table}/${d.id}`}>Open the new {noun}</Link>
                  </p>
                );
              }
            : undefined,
      }}
    />
  );
}

/** Stamps verifiedAt with now after a person re-checked the record against its source. Keeps the previous version. */
export function MarkVerified({ table, id, title, tone }: { table: string; id: string; title: string; tone?: 'quiet' | 'ghost' }) {
  return (
    <QuickAction
      label="Mark verified"
      busyLabel="Marking…"
      done={`${title} marked verified.`}
      accessibleName={`Mark ${title} verified`}
      tone={tone}
      calls={[{ capability: 'mark_content_verified', input: { table, id } }]}
    />
  );
}

/**
 * Up or Down in a table sorted by position: the kit's `QuickAction`, with the two saves `swapOrder`
 * builds (this record takes its neighbour's place and the neighbour takes this one's; two that share
 * a place are set one apart). Each save sends only the position (`merge`), so the list's summaries
 * are enough and nothing is read first.
 */
export function MoveRecord({
  table,
  record,
  other,
  direction,
}: {
  table: string;
  record: { id: string; title: string; sortOrder: number };
  other: { id: string; title: string; sortOrder: number } | null;
  direction: 'up' | 'down';
}) {
  const build = (r: { id: string }, patch: { sortOrder: number }) => ({ table, id: r.id, data: { order: patch.sortOrder }, merge: true });
  return (
    <QuickAction
      label={direction === 'up' ? 'Up' : 'Down'}
      busyLabel="Moving…"
      done={`Moved ${record.title} ${direction}.`}
      unavailable={!other}
      accessibleName={`Move ${record.title} ${direction}`}
      calls={other ? swapOrder(record, other, direction === 'up', build, 'save_content_record') : []}
    />
  );
}
