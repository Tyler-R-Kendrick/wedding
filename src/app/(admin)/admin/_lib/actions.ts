'use server';

import { redirect } from 'next/navigation';
import { newId } from '@/contracts/ids';
import { adminInvoke } from './invoke';

const str = (fd: FormData, key: string): string => {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
};
const opt = (fd: FormData, key: string): string | null => str(fd, key) || null;
const bool = (fd: FormData, key: string): boolean => fd.get(key) === 'on' || fd.get(key) === '1';
/** Present checkbox → true/false; absent from the form → undefined (keep). */
const boolIfPresent = (fd: FormData, key: string): boolean | undefined => (fd.get(`${key}__present`) ? bool(fd, key) : undefined);
const strIfPresent = (fd: FormData, key: string): string | undefined => (fd.has(key) ? str(fd, key) : undefined);
const optIfPresent = (fd: FormData, key: string): string | null | undefined => (fd.has(key) ? str(fd, key) || null : undefined);
/** Idempotent admin mutations carry a key: the form's render-time key when present (double-submit safe), else a fresh one. */
const idem = (fd: FormData) => ({ idempotencyKey: str(fd, 'idem') || newId() });

function finish(page: string, r: { ok: true } | { ok: false; error: { code: string; message: string } }, okMessage: string): never {
  if (!r.ok) {
    if (r.error.code === 'step_up_required') redirect(`/step-up?next=${encodeURIComponent(page)}`);
    redirect(`${page}?error=${encodeURIComponent(r.error.message.slice(0, 200))}`);
  }
  redirect(`${page}?ok=${encodeURIComponent(okMessage)}`);
}

export async function saveGuest(fd: FormData): Promise<void> {
  // Only fields present in the submitted form are sent; the capability keeps everything else (review N3).
  const r = await adminInvoke('admin_upsert_guest', {
    id: opt(fd, 'id') ?? undefined,
    householdId: str(fd, 'householdId'),
    firstName: str(fd, 'firstName'),
    lastName: strIfPresent(fd, 'lastName'),
    email: optIfPresent(fd, 'email'),
    kind: strIfPresent(fd, 'kind') || undefined,
    isMinor: boolIfPresent(fd, 'isMinor'),
    managedByGuestId: optIfPresent(fd, 'managedByGuestId'),
    notes: optIfPresent(fd, 'notes'),
  }, idem(fd));
  finish('/admin/guests', r, 'Guest saved.');
}

export async function deleteGuest(fd: FormData): Promise<void> {
  finish('/admin/guests', await adminInvoke('admin_delete_guest', { guestId: str(fd, 'guestId') }, idem(fd)), 'Guest deleted.');
}

export async function mergeGuests(fd: FormData): Promise<void> {
  finish('/admin/guests', await adminInvoke('admin_merge_guests', { keepId: str(fd, 'keepId'), mergeId: str(fd, 'mergeId') }, idem(fd)), 'Guests merged.');
}

export async function resetIdentity(fd: FormData): Promise<void> {
  finish('/admin/guests', await adminInvoke('admin_reset_identity', { guestId: str(fd, 'guestId'), reason: str(fd, 'reason') || 'admin reset' }, idem(fd)), 'Access reset; the guest can claim again.');
}

export async function rebindIdentity(fd: FormData): Promise<void> {
  finish('/admin/guests', await adminInvoke('admin_rebind_identity', { guestId: str(fd, 'guestId'), email: str(fd, 'email'), reason: str(fd, 'reason') || 'admin rebind' }, idem(fd)), 'Access moved to the new email.');
}

export async function importGuestsCsv(fd: FormData): Promise<void> {
  const r = await adminInvoke<{ dryRun: boolean; householdsCreated: number; guestsCreated: number; guestsUpdated: number; skipped: number; issues: { line: number; message: string }[] }>('admin_import_guests_csv', { csv: str(fd, 'csv'), dryRun: bool(fd, 'dryRun') }, idem(fd));
  if (!r.ok) redirect(`/admin/guests?error=${encodeURIComponent(r.error.message)}`);
  const d = r.value.data;
  const issues = d.issues.slice(0, 5).map((i) => `line ${i.line}: ${i.message}`).join('; ');
  redirect(`/admin/guests?ok=${encodeURIComponent(`${d.dryRun ? 'Dry run — ' : ''}${d.householdsCreated} households, ${d.guestsCreated} guests created, ${d.guestsUpdated} updated, ${d.skipped} skipped${issues ? ` (${issues})` : ''}`)}`);
}

export async function saveHousehold(fd: FormData): Promise<void> {
  const address = { line1: str(fd, 'line1'), line2: str(fd, 'line2'), city: str(fd, 'city'), region: str(fd, 'region'), postalCode: str(fd, 'postalCode'), country: str(fd, 'country') };
  const r = await adminInvoke('admin_upsert_household', {
    id: opt(fd, 'id') ?? undefined,
    name: str(fd, 'name'),
    managerGuestId: opt(fd, 'managerGuestId'),
    mailingAddress: Object.values(address).some(Boolean) ? address : null,
    notes: opt(fd, 'notes'),
  }, idem(fd));
  finish('/admin/households', r, 'Household saved.');
}

export async function deleteHousehold(fd: FormData): Promise<void> {
  finish('/admin/households', await adminInvoke('admin_delete_household', { householdId: str(fd, 'householdId') }, idem(fd)), 'Household deleted.');
}

export async function revokeInvitation(fd: FormData): Promise<void> {
  finish('/admin/invitations', await adminInvoke('admin_revoke_invitation', { invitationId: str(fd, 'invitationId'), reason: str(fd, 'reason') || 'revoked by admin' }, idem(fd)), 'Invitation link revoked.');
}

export interface IssuedLink {
  ok: boolean;
  error?: string;
  code?: string;
  url?: string;
  qrSvg?: string;
  householdId?: string;
  expiresAt?: string;
}

/** Issue / rotate return the token exactly once, so they render inline (useActionState) instead of redirecting. */
export async function issueInvitation(_prev: IssuedLink, fd: FormData): Promise<IssuedLink> {
  const rotate = str(fd, 'invitationId');
  const eventKeys = str(fd, 'eventKeys').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const r = rotate
    ? await adminInvoke<{ url: string; qrSvg: string; invitation: { householdId: string; expiresAt: string } }>('admin_rotate_invitation', { invitationId: rotate }, idem(fd))
    : await adminInvoke<{ url: string; qrSvg: string; invitation: { householdId: string; expiresAt: string } }>('admin_issue_invitation', {
        householdId: str(fd, 'householdId'),
        eventKeys,
        plusOneAllowance: Number(str(fd, 'plusOneAllowance') || 0),
        childrenAllowance: Number(str(fd, 'childrenAllowance') || 0),
      }, idem(fd));
  if (!r.ok) return { ok: false, error: r.error.message, code: r.error.code };
  return { ok: true, url: r.value.data.url, qrSvg: r.value.data.qrSvg, householdId: r.value.data.invitation.householdId, expiresAt: r.value.data.invitation.expiresAt };
}

export async function setAdminRole(fd: FormData): Promise<void> {
  const role = str(fd, 'role');
  finish('/admin/guests', await adminInvoke('admin_set_admin_role', { email: str(fd, 'email'), role: role === 'none' ? null : role }, idem(fd)), 'Admin role updated.');
}
