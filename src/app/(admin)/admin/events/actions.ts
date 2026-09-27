'use server';

import { adminSetEventEntitlements, adminSetMealOptions, adminSetRsvpWindow, adminUpsertEvent, adminUpsertNotice } from '@/capabilities/rsvp';
import { newId } from '@/contracts/ids';
import { chicagoLocalToIso } from '@/domain/events/format';
import { adminInvoke, back, describeError, field, flag, num } from '../../_shared/admin';

const PATH = '/admin/events';

export async function saveEventAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(
    adminUpsertEvent,
    {
      id: field(fd, 'id') ?? undefined,
      name: field(fd, 'name') ?? '',
      description: field(fd, 'description'),
      dateIso: field(fd, 'dateIso') ?? '2027-07-17',
      startsAt: chicagoLocalToIso(field(fd, 'startsAt')),
      endsAt: chicagoLocalToIso(field(fd, 'endsAt')),
      venueSpaceRef: field(fd, 'venueSpaceRef'),
      dressCode: field(fd, 'dressCode'),
      accessibilityNote: field(fd, 'accessibilityNote'),
      placeholder: flag(fd, 'placeholder'),
      rsvpRequired: flag(fd, 'rsvpRequired'),
      sortOrder: num(fd, 'sortOrder', 0),
    },
    { idempotencyKey: field(fd, 'idem') ?? undefined },
  );
  back(PATH, r.ok ? { ok: `Saved ${r.value.data.name}.` } : { error: describeError(r.error) });
}

export async function saveMealsAction(fd: FormData): Promise<void> {
  const lines = (field(fd, 'options') ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [label, description] = l.split('|').map((s) => s.trim());
      return { label: label ?? '', description: description || null };
    });
  const r = await adminInvoke(adminSetMealOptions, { eventId: field(fd, 'eventId'), options: lines }, { idempotencyKey: field(fd, 'idem') ?? undefined });
  back(PATH, r.ok ? { ok: `Menu version ${r.value.data.version} published (${r.value.data.options.length} options).` } : { error: describeError(r.error) });
}

export async function saveWindowAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminSetRsvpWindow, { mode: field(fd, 'mode') ?? 'auto', deadlineAt: chicagoLocalToIso(field(fd, 'deadlineAt')), note: field(fd, 'note') }, { idempotencyKey: field(fd, 'idem') ?? undefined });
  back(PATH, r.ok ? { ok: `RSVPs are now ${r.value.data.open ? 'open' : 'closed'} (${r.value.data.reason.replace('_', ' ')}).` } : { error: describeError(r.error) });
}

/** The capability's per-call cap (`changes.max(500)` in admin_events.ts). */
const ENTITLEMENT_CHUNK = 500;

export async function saveEntitlementsAction(fd: FormData): Promise<void> {
  // Every cell carries the value it was rendered with (`was:<guest>:<event>`), and only cells the
  // admin changed are sent: posting the whole guest × event grid overran the capability's 500-change
  // cap at about 100 guests and rewrote every row that had not moved.
  const changes: Array<{ guestId: string; eventId: string; invited: boolean; plusOnePolicy?: 'none' | 'named' | 'unnamed' }> = [];
  for (const [key, value] of fd.entries()) {
    const m = /^ent:([^:]+):([^:]+)$/.exec(key);
    if (!m || typeof value !== 'string') continue;
    const [, guestId, eventId] = m as unknown as [string, string, string];
    if (fd.get(`was:${guestId}:${eventId}`) === value) continue;
    if (value === 'no') changes.push({ guestId, eventId, invited: false });
    else if (value === 'none' || value === 'named' || value === 'unnamed') changes.push({ guestId, eventId, invited: true, plusOnePolicy: value });
  }
  if (!changes.length) back(PATH, { ok: 'Nothing changed.' });
  const idem = field(fd, 'idem') ?? newId();
  let applied = 0;
  for (let at = 0, n = 0; at < changes.length; at += ENTITLEMENT_CHUNK, n++) {
    const r = await adminInvoke(adminSetEventEntitlements, { changes: changes.slice(at, at + ENTITLEMENT_CHUNK) }, { idempotencyKey: n === 0 ? idem : `${idem}-${n}` });
    if (!r.ok) back(PATH, { error: `${applied ? `Saved ${applied} cells, then: ` : ''}${describeError(r.error)}` });
    applied += r.value.data.applied;
  }
  back(PATH, { ok: `Updated ${applied} invitation cells.` });
}

export async function saveNoticeAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(
    adminUpsertNotice,
    { id: field(fd, 'id') ?? undefined, title: field(fd, 'title') ?? '', body: field(fd, 'body') ?? '', severity: field(fd, 'severity') ?? 'info', active: flag(fd, 'active'), startsAt: chicagoLocalToIso(field(fd, 'startsAt')), endsAt: chicagoLocalToIso(field(fd, 'endsAt')) },
    { idempotencyKey: field(fd, 'idem') ?? undefined },
  );
  back(PATH, r.ok ? { ok: `Notice "${r.value.data.title}" saved (${r.value.data.active ? 'active' : 'inactive'}).` } : { error: describeError(r.error) });
}
