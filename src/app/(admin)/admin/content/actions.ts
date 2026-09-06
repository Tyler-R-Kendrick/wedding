'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCapabilityContext } from '@/capabilities/context';
import { invoke } from '@/capabilities/invoke';
import { markContentVerified } from '@/capabilities/mark_content_verified';
import { saveContentRecord } from '@/capabilities/save_content_record';
import type { CapabilityError } from '@/contracts/errors';
import { CONTENT_TABLE_NAMES, coerceFormValues, TABLE_SPECS } from '@/domain/content/admin';
import type { ContentTableName } from '@/db/schema/content';
import { ROUTES } from '@/domain/routes';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

/**
 * Server actions for the content editors. They parse the form, resolve the principal from the
 * request, and call `invoke`: authorization, idempotency, audit, and validation all happen in
 * the capability pipeline, never here.
 */
export interface SaveState {
  error?: { code: string; message: string; issues?: { path: string; message: string }[] };
  /** Submitted values echoed back so nothing is lost on a validation error. */
  values?: Record<string, string>;
}

const isTable = (v: unknown): v is ContentTableName => typeof v === 'string' && (CONTENT_TABLE_NAMES as readonly string[]).includes(v);

function toState(error: CapabilityError, values: Record<string, string>): SaveState {
  const issues = Array.isArray(error.details?.issues) ? (error.details!.issues as { path: string; message: string }[]) : undefined;
  return { error: { code: error.code, message: error.message, ...(issues ? { issues } : {}) }, values };
}

async function contextFor(idempotencyKey: string | undefined) {
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/admin/content', { headers: h }));
  return createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui', idempotencyKey });
}

export async function saveRecordAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const table = formData.get('table');
  const idRaw = formData.get('id');
  const id = typeof idRaw === 'string' && idRaw.length ? idRaw : undefined;
  const keyRaw = formData.get('idempotencyKey');
  const idempotencyKey = typeof keyRaw === 'string' && keyRaw.length >= 8 ? keyRaw : undefined;
  if (!isTable(table)) return { error: { code: 'validation', message: 'Unknown content table.' } };
  const raw: Record<string, string | undefined> = {};
  const echo: Record<string, string> = {};
  for (const f of TABLE_SPECS[table].fields) {
    const v = formData.get(f.name);
    raw[f.name] = typeof v === 'string' ? v : undefined;
    if (typeof v === 'string') echo[f.name] = v;
  }
  const coerced = coerceFormValues(table, raw);
  if (!coerced.ok) return toState(coerced.error, echo);
  const ctx = await contextFor(idempotencyKey);
  const r = await invoke(saveContentRecord, ctx, { table, id, data: coerced.value });
  if (!r.ok) return toState(r.error, echo);
  redirect(`${ROUTES.adminContent}/${table}/${r.value.data.id}?saved=${r.value.data.contentVersion}`);
}

export async function markVerifiedAction(formData: FormData): Promise<void> {
  const table = formData.get('table');
  const id = formData.get('id');
  const keyRaw = formData.get('idempotencyKey');
  const idempotencyKey = typeof keyRaw === 'string' && keyRaw.length >= 8 ? keyRaw : undefined;
  if (!isTable(table) || typeof id !== 'string') redirect(`${ROUTES.adminContent}?error=validation`);
  const ctx = await contextFor(idempotencyKey);
  const r = await invoke(markContentVerified, ctx, { table, id });
  if (!r.ok) redirect(`${ROUTES.adminContent}/${table}/${id}?error=${encodeURIComponent(r.error.code)}&message=${encodeURIComponent(r.error.message)}`);
  redirect(`${ROUTES.adminContent}/${table}/${id}?verified=${encodeURIComponent(r.value.data.verifiedAt)}`);
}
