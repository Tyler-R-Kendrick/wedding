'use server';

import { adminDeleteTable } from '@/capabilities/rsvp';
import { adminInvoke, back, describeError, field } from '../../_shared/admin';

const PATH = '/admin/seating';

/*
 * The seating screen's changes are flows now (`_components/SeatingFlows.tsx`) that call their
 * capabilities directly. This one action stays only because `tests/unit/admin-confirm.test.ts`
 * still exercises it; nothing on the screen posts to it.
 */
export async function deleteTableAction(fd: FormData): Promise<void> {
  // The form's ConfirmCheck; checked here too so a post without it changes nothing.
  if (field(fd, 'confirm') !== 'yes') back(PATH, { error: 'Nothing was changed: tick the box to confirm.' });
  const r = await adminInvoke(adminDeleteTable, { id: field(fd, 'id') ?? '' }, { idempotencyKey: field(fd, 'idem') ?? undefined });
  back(PATH, r.ok ? { ok: 'Table deleted (draft).' } : { error: describeError(r.error) });
}
