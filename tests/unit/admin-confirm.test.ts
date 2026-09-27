import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Destructive console actions need an explicit "yes": the form's ConfirmCheck posts `confirm=yes`,
 * and the server action refuses without it, so nothing changes on a bare post.
 */
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
const adminInvoke = vi.fn(async () => ({ ok: true as const, value: { data: {} } }));

vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/app/(admin)/admin/_lib/invoke', () => ({ adminInvoke: (...a: unknown[]) => adminInvoke(...(a as [])) }));
vi.mock('@/app/(admin)/_shared/admin', async (orig) => {
  const real = await orig<typeof import('@/app/(admin)/_shared/admin')>();
  return { ...real, adminInvoke: (...a: unknown[]) => adminInvoke(...(a as [])) };
});

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const run = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return 'no redirect';
};

describe('destructive admin actions need confirm=yes', () => {
  beforeEach(() => {
    redirect.mockClear();
    adminInvoke.mockClear();
  });

  it.each([
    ['deleteGuest', { guestId: 'g1' }, '/admin/guests'],
    ['resetIdentity', { guestId: 'g1' }, '/admin/guests'],
    ['mergeGuests', { keepId: 'g1', mergeId: 'g2' }, '/admin/guests'],
    ['deleteHousehold', { householdId: 'h1' }, '/admin/households'],
    ['revokeInvitation', { invitationId: 'i1' }, '/admin/invitations'],
    ['rebindIdentity', { guestId: 'g1', email: 'a@example.test', reason: 'r' }, '/admin/guests'],
    ['setAdminRole', { email: 'a@example.test', role: 'planner' }, '/admin/guests'],
  ] as const)('%s refuses without it and runs with it', async (name, fields, page) => {
    const actions = await import('@/app/(admin)/admin/_lib/actions');
    const action = actions[name] as (fd: FormData) => Promise<void>;
    expect(await run(action(form(fields)))).toBe(`REDIRECT ${page}?error=${encodeURIComponent('Nothing was changed: tick the box to confirm.')}`);
    expect(adminInvoke).not.toHaveBeenCalled();
    expect(await run(action(form({ ...fields, confirm: 'yes' })))).toMatch(new RegExp(`^REDIRECT ${page.replace(/\//g, '\\/')}\\?ok=`));
    expect(adminInvoke).toHaveBeenCalledTimes(1);
  });

  it('deleting a table refuses without it', async () => {
    const { deleteTableAction } = await import('@/app/(admin)/admin/seating/actions');
    expect(await run(deleteTableAction(form({ id: 't1' })))).toMatch(/^REDIRECT \/admin\/seating\?error=/);
    expect(adminInvoke).not.toHaveBeenCalled();
  });

  it('a failed guest edit returns to that guest\'s form', async () => {
    adminInvoke.mockResolvedValueOnce({ ok: false, error: { code: 'validation', message: 'bad' } } as never);
    const { saveGuest } = await import('@/app/(admin)/admin/_lib/actions');
    expect(await run(saveGuest(form({ id: 'g1', householdId: 'h1', firstName: 'A' })))).toBe('REDIRECT /admin/guests?edit=g1&error=bad');
  });

  it('rotating an invitation link refuses without it; issuing a new one does not need it', async () => {
    const { issueInvitation } = await import('@/app/(admin)/admin/_lib/actions');
    expect(await issueInvitation({ ok: false }, form({ invitationId: 'i1' }))).toMatchObject({ ok: false, code: 'validation' });
    expect(adminInvoke).not.toHaveBeenCalled();
  });
});
