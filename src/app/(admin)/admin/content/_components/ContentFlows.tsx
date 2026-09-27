'use client';

import Link from 'next/link';
import { AdminFlow, type FieldErrors, type FlowContext, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { CheckField, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import { QuickAction } from '@/components/admin/flow/QuickAction';
import { callCapability, newIdempotencyKey, type CapabilityResponse } from '@/components/handoff/client';
// Types only: the module itself is server code (drizzle, the database schema).
import type { FieldSpec } from '@/domain/content/admin';
import type { ContentRecordData } from '@/capabilities/get_content_record';

/*
 * The content editor, as flows from the admin kit (`components/admin/flow/CONVENTIONS.md`).
 *
 * It stays generic: one field spec per table (`TABLE_SPECS` in domain/content/admin.ts) drives the
 * steps, the controls and the conversion, as it drove the long single form this replaces. The
 * spec's own fields come first ("What it says", split in two when a table has many), then the
 * provenance every record carries (ADR-0011), then the whole record read back.
 *
 * Values are strings in the flow and are converted here, in the browser, before the one
 * `save_content_record` call. That is also where a `datetime-local` value has to become an
 * instant: only the browser knows which time zone the admin typed it in. The capability validates
 * everything again against the table's zod schema, and its field errors bring the admin back to
 * the step that owns the field.
 */

type Values = Record<string, unknown> & {
  /** The stored instants of the datetime fields, so an untouched one is saved to the millisecond rather than to the minute its input shows. */
  __orig?: Record<string, string>;
};

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

const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** A stored record → the flow's string values. */
function toFlowValues(fields: FieldSpec[], row: Record<string, unknown>): Values {
  const out: Values = { __orig: {} };
  for (const f of fields) {
    const v = row[f.name];
    switch (f.type) {
      case 'boolean':
        out[f.name] = v === true;
        break;
      case 'tristate':
        out[f.name] = v === true ? 'yes' : v === false ? 'no' : '';
        break;
      case 'json':
        out[f.name] = v === null || v === undefined ? '' : JSON.stringify(v, null, 2);
        break;
      case 'datetime':
        out[f.name] = empty(v) ? '' : toLocalInput(String(v));
        if (!empty(v)) out.__orig![f.name] = String(v);
        break;
      default:
        out[f.name] = v === null || v === undefined ? '' : String(v);
    }
  }
  return out;
}

function blankValues(fields: FieldSpec[], defaults: Record<string, string> = {}): Values {
  const out: Values = { __orig: {} };
  for (const f of fields) out[f.name] = f.type === 'boolean' ? defaults[f.name] === 'true' : (defaults[f.name] ?? '');
  return out;
}

/** One field's flow value → what `save_content_record` takes, or the reason it cannot be. */
function convert(f: FieldSpec, raw: unknown, orig: Record<string, string> | undefined): { value?: unknown; error?: string } {
  if (f.type === 'boolean') return { value: raw === true };
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (f.type === 'tristate') return { value: v === 'yes' ? true : v === 'no' ? false : null };
  if (v === '') return f.required ? { error: 'Required.' } : { value: null };
  switch (f.type) {
    case 'number': {
      const n = Number(v);
      return Number.isInteger(n) ? { value: n } : { error: 'Enter a whole number.' };
    }
    case 'float': {
      const n = Number(v);
      return Number.isFinite(n) ? { value: n } : { error: 'Enter a number, like 38.2905.' };
    }
    case 'json':
      try {
        return { value: JSON.parse(v) };
      } catch {
        return { error: f.help ? `This is not valid JSON. Expected: ${f.help}` : 'This is not valid JSON.' };
      }
    case 'datetime': {
      const stored = orig?.[f.name];
      if (stored && toLocalInput(stored) === v) return { value: stored };
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? { error: 'Enter a date and time.' } : { value: d.toISOString() };
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
  for (const f of fields) data[f.name] = convert(f, values[f.name], values.__orig).value;
  return data;
}

/** A value read back on the last step, in words. */
function shown(f: FieldSpec, raw: unknown): string {
  if (f.type === 'boolean') return raw === true ? 'Yes' : 'No';
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (f.type === 'tristate') return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Unknown';
  if (v === '') return '';
  if (f.type === 'datetime') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  const flat = f.type === 'json' ? v.replace(/\s+/g, ' ') : v;
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
}

function Field({ ctx, field: f }: { ctx: FlowContext<Values>; field: FieldSpec }) {
  const optional = !f.required;
  switch (f.type) {
    case 'boolean':
      return <CheckField ctx={ctx} name={f.name} label={f.label} hint={f.help} />;
    case 'tristate':
      return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} placeholder="Unknown" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
    case 'select':
      return <SelectField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} placeholder={optional ? 'Not set' : 'Choose one'} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case 'textarea':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} multiline />;
    case 'json':
      return <TextField ctx={ctx} name={f.name} label={f.label} hint={f.help} optional={optional} multiline rows={6} spellCheck={false} />;
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

function fieldStep(title: string, lede: string, fields: FieldSpec[]): FlowStep<Values> {
  return {
    title,
    lede,
    fields: fields.map((f) => f.name),
    render: (ctx) => (
      <>
        {fields.map((f) => (
          <Field key={f.name} ctx={ctx} field={f} />
        ))}
      </>
    ),
    next: async (v) => {
      const errors = check(fields, v);
      return Object.keys(errors).length ? { errors } : undefined;
    },
  };
}

/** The server's issue paths name a nested item (`paragraphs.0`); the flow knows fields by their top-level name. */
function byTopLevelField(res: CapabilityResponse): CapabilityResponse {
  const issues = res.error?.details?.issues as { path: string; message: string }[] | undefined;
  if (res.ok || !issues?.length) return res;
  const mapped = issues.map((i) => {
    const [head = '', ...rest] = i.path.split('.');
    return { path: head, message: rest.length ? `${rest.join('.')}: ${i.message}` : i.message };
  });
  return { ...res, error: { ...res.error!, details: { ...res.error!.details, issues: mapped } } };
}

export interface ContentRecordFlowProps {
  table: string;
  tableLabel: string;
  fields: FieldSpec[];
  /** Editing: the record to load. Omitted: a new record. */
  record?: { id: string; title: string };
  /** A new record's starting values (the default source, trust class and visibility). */
  defaults?: Record<string, string>;
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
export function ContentRecordFlow({ table, tableLabel, fields, record, defaults, label, variant = 'primary', accessibleName, linkAfterCreate, defaultOpen }: ContentRecordFlowProps) {
  const own = fields.filter((f) => !PROVENANCE.has(f.name));
  const provenance = fields.filter((f) => PROVENANCE.has(f.name));
  const half = Math.ceil(own.length / 2);
  const ownSteps =
    own.length > PER_STEP
      ? [fieldStep('What it says', 'The record as guests and the concierge will read it.', own.slice(0, half)), fieldStep('More details', 'The rest of the record. Leave anything optional empty.', own.slice(half))]
      : [fieldStep('What it says', 'The record as guests and the concierge will read it.', own)];

  // A new record's verification stamp is "now", on this device's clock and in its time zone.
  const initial = record ? blankValues(fields) : blankValues(fields, { ...defaults, verifiedAt: toLocalInput(new Date().toISOString()) });

  const steps: FlowStep<Values>[] = [
    ...ownSteps,
    fieldStep('Source and visibility', 'Where this came from, when it was last checked, and who may see it. A private draft never reaches guests or the concierge.', provenance),
    {
      title: 'Check and save',
      lede: record ? 'Saving keeps the previous version in the history and bumps the content version.' : 'Nothing has been saved yet.',
      render: ({ values }) => <ReviewList items={fields.map((f) => ({ label: f.label, value: shown(f, values[f.name]) }))} />,
    },
  ];

  const name = record ? `Edit ${record.title}` : `Add to ${tableLabel}`;
  return (
    <AdminFlow<Values>
      id={`content:${table}:${record?.id ?? 'new'}`}
      title={name}
      trigger={{ label, variant, accessibleName: accessibleName ?? (record ? name : undefined) }}
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
        label: record ? 'Save changes' : `Add to ${tableLabel}`,
        success: record ? 'Saved. The previous version is kept in the history.' : `Added to ${tableLabel}.`,
        run: async (v) => byTopLevelField(await callCapability('save_content_record', { input: { table, id: record?.id, data: toData(fields, v) }, idempotencyKey: newIdempotencyKey() })),
        result:
          !record && linkAfterCreate
            ? (data) => {
                const d = data as { id: string; contentVersion: number };
                return (
                  <p>
                    Saved as version {d.contentVersion}. <Link href={`/admin/content/${table}/${d.id}`}>Open the new record</Link>
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
