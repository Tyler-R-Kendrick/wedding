'use server';

import { adminOverrideRsvp } from '@/capabilities/rsvp';
import { adminInvoke, back, describeError, field, flag } from '../../_shared/admin';

const PATH = '/admin/rsvp';

export async function overrideAction(fd: FormData): Promise<void> {
  const plusOneWanted = flag(fd, 'plusOne');
  const r = await adminInvoke(
    adminOverrideRsvp,
    {
      guestId: field(fd, 'guestId') ?? '',
      eventId: field(fd, 'eventId') ?? '',
      status: field(fd, 'status') ?? 'accepted',
      mealOptionId: field(fd, 'mealOptionId'),
      plusOne: plusOneWanted || field(fd, 'plusOneName') ? { attending: plusOneWanted, name: field(fd, 'plusOneName'), mealOptionId: field(fd, 'plusOneMealOptionId') } : null,
      reason: field(fd, 'reason') ?? '',
    },
    { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined },
  );
  back(PATH, r.ok ? { ok: `Recorded ${r.value.data.status} (version ${r.value.data.version}, was ${r.value.data.previousStatus ?? 'unanswered'}).` } : { error: describeError(r.error) });
}
