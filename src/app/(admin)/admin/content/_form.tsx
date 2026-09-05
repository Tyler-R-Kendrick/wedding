'use client';

import { useActionState } from 'react';
import type { FieldSpec } from '@/domain/content/admin';
import { saveRecordAction, type SaveState } from './actions';

export interface RecordFormProps {
  table: string;
  tableLabel: string;
  id?: string;
  fields: FieldSpec[];
  initial: Record<string, string>;
  /** Fresh ULID minted by the server page; the pipeline requires one per mutation. */
  idempotencyKey: string;
}

const INITIAL: SaveState = {};

/**
 * Spec-driven editor form. Every field has a visible label, 17px inputs, inline text errors,
 * and an error summary that names the fields. Progressive enhancement: works without JS too.
 */
export function RecordForm({ table, tableLabel, id, fields, initial, idempotencyKey }: RecordFormProps) {
  const [state, action, pending] = useActionState(saveRecordAction, INITIAL);
  const values = state.values ?? initial;
  const issueFor = (name: string) => state.error?.issues?.find((i) => i.path === name || i.path.startsWith(`${name}.`))?.message;

  return (
    <form action={action} className="ac-form" aria-describedby={state.error ? 'form-error' : undefined}>
      <input type="hidden" name="table" value={table} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {state.error ? (
        <div id="form-error" className="ac-warn" role="alert" tabIndex={-1}>
          <p>
            <strong>Not saved.</strong> {state.error.message}
          </p>
          {state.error.issues?.length ? (
            <ul>
              {state.error.issues.map((i) => (
                <li key={`${i.path}-${i.message}`}>
                  <a href={`#field-${i.path.split('.')[0]}`}>{i.path || 'record'}</a>: {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {fields.map((f) => (
        <Field key={f.name} field={f} value={values[f.name] ?? ''} error={issueFor(f.name)} />
      ))}
      <div className="ac-actions">
        <button className="ac-button" type="submit" disabled={pending}>
          {pending ? 'Saving…' : id ? `Save ${tableLabel}` : `Create ${tableLabel}`}
        </button>
        <span className="ac-muted">Saving keeps the previous version and bumps the content version.</span>
      </div>
    </form>
  );
}

function Field({ field, value, error }: { field: FieldSpec; value: string; error?: string }) {
  const id = `field-${field.name}`;
  const helpId = field.help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const common = { id, name: field.name, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required: field.required };

  let control: React.ReactNode;
  switch (field.type) {
    case 'textarea':
    case 'json':
      control = <textarea {...common} defaultValue={value} rows={field.type === 'json' ? 6 : 4} />;
      break;
    case 'select':
      control = (
        <select {...common} defaultValue={value}>
          {!field.required ? <option value="">—</option> : null}
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    case 'tristate':
      control = (
        <select {...common} defaultValue={value}>
          <option value="">Unknown</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
      break;
    case 'boolean':
      return (
        <div className="ac-field">
          <div className="ac-check">
            <input id={id} name={field.name} type="checkbox" defaultChecked={value === 'on' || value === 'true'} aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
            <label htmlFor={id}>{field.label}</label>
          </div>
          {field.help ? (
            <p id={helpId} className="ac-help">
              {field.help}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} className="ac-error">
              {error}
            </p>
          ) : null}
        </div>
      );
    case 'number':
      control = <input {...common} type="number" step={1} defaultValue={value} inputMode="numeric" />;
      break;
    case 'float':
      control = <input {...common} type="number" step="any" defaultValue={value} inputMode="decimal" />;
      break;
    case 'url':
      control = <input {...common} type="url" defaultValue={value} inputMode="url" />;
      break;
    default:
      control = <input {...common} type="text" defaultValue={value} />;
  }
  return (
    <div className="ac-field">
      <label htmlFor={id}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      {control}
      {field.help ? (
        <p id={helpId} className="ac-help">
          {field.help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ac-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
