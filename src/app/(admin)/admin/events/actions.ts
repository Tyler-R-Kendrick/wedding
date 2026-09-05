'use server';

import { adminSetEventEntitlements, adminSetMealOptions, adminSetRsvpWindow, adminUpsertEvent, adminUpsertNotice } from '@/capabilities/rsvp';
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
    { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined },
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
  const r = await adminInvoke(adminSetMealOptions, { eventId: field(fd, 'eventId'), options: lines }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: `Menu version ${r.value.data.version} published (${r.value.data.options.length} options).` } : { error: describeError(r.error) });
}

export async function saveWindowAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminSetRsvpWindow, { mode: field(fd, 'mode') ?? 'auto', deadlineAt: chicagoLocalToIso(field(fd, 'deadlineAt')), note: field(fd, 'note') }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: `RSVPs are now ${r.value.data.open ? 'open' : 'closed'} (${r.value.data.reason.replace('_', ' ')}).` } : { error: describeError(r.error) });
}

export async function saveEntitlementsAction(fd: FormData): Promise<void> {
  const changes: Array<{ guestId: string; eventId: string; invited: boolean; plusOnePolicy?: 'none' | 'named' | 'unnamed' }> = [];
  for (const [key, value] of fd.entries()) {
    const m = /^ent:([^:]+):([^:]+)$/.exec(key);
    if (!m || typeof value !== 'string') continue;
    const [, guestId, eventId] = m as unknown as [string, string, string];
    if (value === 'no') changes.push({ guestId, eventId, invited: false });
    else if (value === 'none' || value === 'named' || value === 'unnamed') changes.push({ guestId, eventId, invited: true, plusOnePolicy: value });
  }
  const r = await adminInvoke(adminSetEventEntitlements, { changes }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: `Updated ${r.value.data.applied} invitation cells.` } : { error: describeError(r.error) });
}

export async function saveNoticeAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(
    adminUpsertNotice,
    { id: field(fd, 'id') ?? undefined, title: field(fd, 'title') ?? '', body: field(fd, 'body') ?? '', severity: field(fd, 'severity') ?? 'info', active: flag(fd, 'active'), startsAt: chicagoLocalToIso(field(fd, 'startsAt')), endsAt: chicagoLocalToIso(field(fd, 'endsAt')) },
    { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined },
  );
  back(PATH, r.ok ? { ok: `Notice "${r.value.data.title}" saved (${r.value.data.active ? 'active' : 'inactive'}).` } : { error: describeError(r.error) });
}
