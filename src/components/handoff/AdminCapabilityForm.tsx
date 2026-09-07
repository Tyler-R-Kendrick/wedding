'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { callCapability, newIdempotencyKey } from './client';

export type AdminField =
  | { name: string; label: string; type: 'text' | 'url' | 'datetime-local' | 'date'; required?: boolean; help?: string; defaultValue?: string }
  | { name: string; label: string; type: 'number'; required?: boolean; help?: string; defaultValue?: number; min?: number; max?: number }
  | { name: string; label: string; type: 'checkbox'; help?: string; defaultValue?: boolean }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[]; defaultValue?: string; help?: string }
  | { name: string; label: string; type: 'lines'; required?: boolean; help?: string };

const INPUT = 'w-full border border-primary/40 bg-neutral px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** A small, generic admin form: every field has a visible label; submission goes through one capability with an idempotency key. */
export function AdminCapabilityForm({ capability, fields, submitLabel, title }: { capability: string; fields: AdminField[]; submitLabel: string; title: string }) {
  const router = useRouter();
  const id = useId();
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string; issues?: { path: string; message: string }[] }>({ kind: 'idle' });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const input: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = form.get(f.name);
      if (f.type === 'checkbox') input[f.name] = raw === 'on';
      else if (f.type === 'number') input[f.name] = raw === null || raw === '' ? undefined : Number(raw);
      else if (f.type === 'lines') input[f.name] = String(raw ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      else if (f.type === 'datetime-local' || f.type === 'date') input[f.name] = raw ? new Date(String(raw)).toISOString() : undefined;
      else input[f.name] = raw === null || raw === '' ? undefined : String(raw);
    }
    setStatus({ kind: 'busy' });
    const res = await callCapability(capability, { input, idempotencyKey: newIdempotencyKey() });
    if (!res.ok) {
      setStatus({ kind: 'error', message: res.error?.message ?? 'Something went wrong.', issues: (res.error?.details?.issues as { path: string; message: string }[] | undefined) ?? undefined });
      return;
    }
    setStatus({ kind: 'ok', message: 'Saved.' });
    e.currentTarget?.reset?.();
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="max-w-[40rem] border border-primary/20 p-6" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-xl">
        {title}
      </h3>
      <div className="mt-4 grid gap-4">
        {fields.map((f) => {
          const fid = `${id}-${f.name}`;
          const help = f.help ? <p id={`${fid}-help`} className="mt-1 hint">{f.help}</p> : null;
          const describedBy = f.help ? `${fid}-help` : undefined;
          if (f.type === 'checkbox') {
            return (
              <div key={f.name}>
                <label className="inline-flex min-h-11 items-center gap-2" htmlFor={fid}>
                  <input id={fid} name={f.name} type="checkbox" defaultChecked={f.defaultValue} aria-describedby={describedBy} className="size-5" />
                  {f.label}
                </label>
                {help}
              </div>
            );
          }
          if (f.type === 'select') {
            return (
              <div key={f.name}>
                <label className="block" htmlFor={fid}>
                  {f.label}
                </label>
                <select id={fid} name={f.name} defaultValue={f.defaultValue} aria-describedby={describedBy} className={INPUT}>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {help}
              </div>
            );
          }
          if (f.type === 'lines') {
            return (
              <div key={f.name}>
                <label className="block" htmlFor={fid}>
                  {f.label}
                </label>
                <textarea id={fid} name={f.name} required={f.required} rows={6} aria-describedby={describedBy} className={INPUT} autoComplete="off" spellCheck={false} />
                {help}
              </div>
            );
          }
          return (
            <div key={f.name}>
              <label className="block" htmlFor={fid}>
                {f.label}
              </label>
              <input
                id={fid}
                name={f.name}
                type={f.type}
                required={f.required}
                defaultValue={f.defaultValue as string | number | undefined}
                aria-describedby={describedBy}
                className={INPUT}
                autoComplete="off"
                {...(f.type === 'number' ? { min: f.min, max: f.max, step: 1 } : {})}
              />
              {help}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={status.kind === 'busy'} className="inline-flex min-h-11 items-center rounded-[var(--radius-button,2px)] bg-primary px-7 py-3 text-base text-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">
          {submitLabel}
        </button>
        {status.kind === 'ok' ? <p role="status">{status.message}</p> : null}
        {status.kind === 'error' ? (
          <div role="alert">
            <p>{status.message}</p>
            {status.issues?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {status.issues.map((i) => (
                  <li key={`${i.path}-${i.message}`}>
                    {i.path}: {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  );
}
